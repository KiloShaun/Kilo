import { EventEmitter2 } from '@nestjs/event-emitter';
import { EmergencyStatus, UserRole } from '@prisma/client';
import { EmergencyService } from './emergency.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { NotFoundDomainError } from '../common/errors/domain-error';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';

interface MockTx {
  emergencyIncident: { create: jest.Mock; update: jest.Mock };
  journeyEvent: { create: jest.Mock };
}

interface MockPrisma {
  journey: { findFirst: jest.Mock };
  childJourney: { findMany: jest.Mock };
  user: { findMany: jest.Mock };
  emergencyIncident: { findUnique: jest.Mock };
  child: { findMany: jest.Mock; findFirst: jest.Mock };
  $transaction: jest.Mock;
}

function asUser(overrides: Partial<AuthenticatedUser>): AuthenticatedUser {
  return { id: 'user-1', email: 'user@example.com', role: UserRole.DRIVER, ...overrides };
}

describe('EmergencyService', () => {
  let service: EmergencyService;
  let prisma: MockPrisma;
  let tx: MockTx;
  let events: { emit: jest.Mock };

  const journey = {
    id: 'journey-1',
    driverId: 'driver-1',
    vehicleId: 'vehicle-1',
    route: { schoolId: 'school-1' },
  };

  beforeEach(() => {
    tx = {
      emergencyIncident: {
        create: jest.fn().mockResolvedValue({ id: 'incident-1' }),
        update: jest.fn(),
      },
      journeyEvent: { create: jest.fn() },
    };
    prisma = {
      journey: { findFirst: jest.fn().mockResolvedValue(journey) },
      childJourney: { findMany: jest.fn().mockResolvedValue([]) },
      user: { findMany: jest.fn().mockResolvedValue([{ id: 'operator-1' }]) },
      emergencyIncident: {
        findUnique: jest.fn(),
      },
      child: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn() },
      $transaction: jest.fn((callback: (tx: MockTx) => unknown) => callback(tx)),
    };
    events = { emit: jest.fn() };
    service = new EmergencyService(
      prisma as unknown as PrismaService,
      events as unknown as EventEmitter2,
    );
  });

  describe('triggerSos', () => {
    it('refuses a driver triggering SOS for a journey they do not drive', async () => {
      await expect(
        service.triggerSos({ journeyId: 'journey-1' }, asUser({ driverId: 'someone-else' })),
      ).rejects.toThrow(NotFoundDomainError);
    });

    it('snapshots affected children and notifies operators + parents', async () => {
      prisma.childJourney.findMany.mockResolvedValue([
        {
          childId: 'child-1',
          child: { parent: { userId: 'parent-user-1' } },
        },
      ]);
      prisma.emergencyIncident.findUnique.mockResolvedValue({
        id: 'incident-1',
        status: 'TRIGGERED',
      });

      await service.triggerSos(
        { journeyId: 'journey-1', latitude: -26.2, longitude: 28.0, note: 'Flat tyre' },
        asUser({ driverId: 'driver-1' }),
      );

      expect(tx.emergencyIncident.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ affectedChildIds: ['child-1'] }),
        }),
      );
      expect(events.emit).toHaveBeenCalledWith(
        'emergency.triggered',
        expect.objectContaining({
          incidentId: 'incident-1',
          operatorUserIds: ['operator-1'],
          affectedParentUserIds: ['parent-user-1'],
        }),
      );
    });
  });

  describe('acknowledge / resolve idempotency', () => {
    it('is a no-op acknowledging an already-resolved incident', async () => {
      const resolved = {
        id: 'incident-1',
        status: EmergencyStatus.RESOLVED,
        driverId: 'driver-1',
        journey: { route: { schoolId: 'school-1' } },
      };
      prisma.emergencyIncident.findUnique.mockResolvedValue(resolved);

      const result = await service.acknowledge(
        'incident-1',
        asUser({ role: UserRole.SUPER_ADMIN }),
      );

      expect(result).toEqual(resolved);
      expect(tx.emergencyIncident.update).not.toHaveBeenCalled();
    });
  });

  describe('findOneScoped', () => {
    it('denies a school admin from a different school', async () => {
      prisma.emergencyIncident.findUnique.mockResolvedValue({
        id: 'incident-1',
        status: EmergencyStatus.TRIGGERED,
        driverId: 'driver-1',
        journey: { route: { schoolId: 'school-1' } },
      });

      await expect(
        service.findOneScoped(
          'incident-1',
          asUser({ role: UserRole.SCHOOL_ADMIN, schoolAdminSchoolId: 'other-school' }),
        ),
      ).rejects.toThrow(NotFoundDomainError);
    });

    it('denies a parent whose child was not affected', async () => {
      prisma.emergencyIncident.findUnique.mockResolvedValue({
        id: 'incident-1',
        status: EmergencyStatus.TRIGGERED,
        affectedChildIds: ['child-1'],
        journey: { route: { schoolId: 'school-1' } },
      });
      prisma.child.findFirst.mockResolvedValue(null);

      await expect(
        service.findOneScoped(
          'incident-1',
          asUser({ role: UserRole.PARENT, parentId: 'parent-2' }),
        ),
      ).rejects.toThrow(NotFoundDomainError);
    });
  });
});
