import { ChildJourneyStatus, JourneyStatus, UserRole } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JourneysService } from './journeys.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { ConflictDomainError, NotFoundDomainError } from '../common/errors/domain-error';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';

interface MockTx {
  childJourney: { update: jest.Mock };
  journeyEvent: { create: jest.Mock };
  journey: { update: jest.Mock };
}

interface MockPrisma {
  journey: { findFirst: jest.Mock };
  childJourney: { findUnique: jest.Mock };
  $transaction: jest.Mock;
}

describe('JourneysService', () => {
  let service: JourneysService;
  let prisma: MockPrisma;
  let tx: MockTx;
  let events: { emit: jest.Mock };

  const driver = asUser({ role: UserRole.DRIVER, driverId: 'driver-1' });
  const journey = {
    id: 'journey-1',
    driverId: 'driver-1',
    routeId: 'route-1',
    status: JourneyStatus.DRIVER_STARTED,
    route: { schoolId: 'school-1', name: 'Route 1' },
  };

  function asUser(overrides: Partial<AuthenticatedUser>): AuthenticatedUser {
    return { id: 'user-1', email: 'user@example.com', role: UserRole.DRIVER, ...overrides };
  }

  function childJourney(status: ChildJourneyStatus) {
    return {
      id: 'cj-1',
      status,
      journeyId: 'journey-1',
      childId: 'child-1',
      child: { firstName: 'Amy', parent: { userId: 'parent-user-1' } },
      journey: { routeId: 'route-1', route: journey.route },
    };
  }

  beforeEach(() => {
    tx = {
      childJourney: { update: jest.fn() },
      journeyEvent: { create: jest.fn() },
      journey: { update: jest.fn() },
    };
    prisma = {
      journey: { findFirst: jest.fn().mockResolvedValue(journey) },
      childJourney: { findUnique: jest.fn() },
      $transaction: jest.fn((callback: (tx: MockTx) => unknown) => callback(tx)),
    };
    events = { emit: jest.fn() };
    service = new JourneysService(
      prisma as unknown as PrismaService,
      events as unknown as EventEmitter2,
    );
  });

  describe('assertDriverOwnsJourney (via pickupChild)', () => {
    it('refuses a driver who does not own the journey', async () => {
      await expect(
        service.pickupChild(
          'journey-1',
          'child-1',
          { verificationMethod: 'MANUAL' as never },
          asUser({ role: UserRole.DRIVER, driverId: 'someone-else' }),
        ),
      ).rejects.toThrow(NotFoundDomainError);
    });
  });

  describe('pickupChild', () => {
    it('picks up a not-yet-boarded child and emits an event', async () => {
      prisma.childJourney.findUnique.mockResolvedValue(
        childJourney(ChildJourneyStatus.NOT_YET_BOARDED),
      );
      tx.childJourney.update.mockResolvedValue(childJourney(ChildJourneyStatus.ON_VEHICLE));

      const result = await service.pickupChild(
        'journey-1',
        'child-1',
        { verificationMethod: 'MANUAL' as never },
        driver,
      );

      expect(result.status).toBe(ChildJourneyStatus.ON_VEHICLE);
      expect(events.emit).toHaveBeenCalledWith(
        'journey.child.pickedUp',
        expect.objectContaining({ childId: 'child-1' }),
      );
    });

    it('is idempotent when the child is already on the vehicle', async () => {
      const existing = childJourney(ChildJourneyStatus.ON_VEHICLE);
      prisma.childJourney.findUnique.mockResolvedValue(existing);

      const result = await service.pickupChild(
        'journey-1',
        'child-1',
        { verificationMethod: 'MANUAL' as never },
        driver,
      );

      expect(result).toBe(existing);
      expect(tx.childJourney.update).not.toHaveBeenCalled();
      expect(events.emit).not.toHaveBeenCalled();
    });

    it('refuses to pick up a child who already dropped off', async () => {
      prisma.childJourney.findUnique.mockResolvedValue(
        childJourney(ChildJourneyStatus.DROPPED_OFF),
      );

      await expect(
        service.pickupChild(
          'journey-1',
          'child-1',
          { verificationMethod: 'MANUAL' as never },
          driver,
        ),
      ).rejects.toThrow(ConflictDomainError);
    });
  });

  describe('dropoffChild', () => {
    it('refuses to drop off a child who was never picked up', async () => {
      prisma.childJourney.findUnique.mockResolvedValue(
        childJourney(ChildJourneyStatus.NOT_YET_BOARDED),
      );

      await expect(
        service.dropoffChild(
          'journey-1',
          'child-1',
          { verificationMethod: 'MANUAL' as never },
          driver,
        ),
      ).rejects.toThrow(ConflictDomainError);
    });

    it('is idempotent when the child is already dropped off', async () => {
      const existing = childJourney(ChildJourneyStatus.DROPPED_OFF);
      prisma.childJourney.findUnique.mockResolvedValue(existing);

      const result = await service.dropoffChild(
        'journey-1',
        'child-1',
        { verificationMethod: 'MANUAL' as never },
        driver,
      );

      expect(result).toBe(existing);
      expect(tx.childJourney.update).not.toHaveBeenCalled();
    });

    it('drops off a child who is on the vehicle', async () => {
      prisma.childJourney.findUnique.mockResolvedValue(childJourney(ChildJourneyStatus.ON_VEHICLE));
      tx.childJourney.update.mockResolvedValue(childJourney(ChildJourneyStatus.DROPPED_OFF));

      const result = await service.dropoffChild(
        'journey-1',
        'child-1',
        { verificationMethod: 'MANUAL' as never },
        driver,
      );

      expect(result.status).toBe(ChildJourneyStatus.DROPPED_OFF);
      expect(events.emit).toHaveBeenCalledWith(
        'journey.child.droppedOff',
        expect.objectContaining({ childId: 'child-1' }),
      );
    });
  });

  describe('start', () => {
    it('is idempotent when already started', async () => {
      prisma.journey.findFirst.mockResolvedValue({
        ...journey,
        status: JourneyStatus.DRIVER_STARTED,
      });
      const result = await service.start('journey-1', driver);
      expect(result.status).toBe(JourneyStatus.DRIVER_STARTED);
      expect(tx.journey.update).not.toHaveBeenCalled();
    });

    it('refuses to start a cancelled journey', async () => {
      prisma.journey.findFirst.mockResolvedValue({ ...journey, status: JourneyStatus.CANCELLED });
      await expect(service.start('journey-1', driver)).rejects.toThrow(ConflictDomainError);
    });
  });
});
