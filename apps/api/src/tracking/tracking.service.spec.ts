import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { UserRole } from '@prisma/client';
import { TrackingService } from './tracking.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { JourneysService } from '../journeys/journeys.service';
import { NotFoundDomainError } from '../common/errors/domain-error';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';

function asUser(overrides: Partial<AuthenticatedUser>): AuthenticatedUser {
  return { id: 'user-1', email: 'user@example.com', role: UserRole.DRIVER, ...overrides };
}

describe('TrackingService', () => {
  let service: TrackingService;
  let prisma: { journey: { findFirst: jest.Mock }; gPSLocation: { create: jest.Mock } };
  let redis: { set: jest.Mock; get: jest.Mock };
  let journeysService: { findOneScoped: jest.Mock };
  let events: { emit: jest.Mock };
  let configService: ConfigService;

  const journey = { id: 'journey-1', driverId: 'driver-1', vehicleId: 'vehicle-1' };

  beforeEach(() => {
    prisma = {
      journey: { findFirst: jest.fn().mockResolvedValue(journey) },
      gPSLocation: { create: jest.fn().mockResolvedValue({ id: 'gps-1' }) },
    };
    redis = { set: jest.fn(), get: jest.fn() };
    journeysService = { findOneScoped: jest.fn().mockResolvedValue(journey) };
    events = { emit: jest.fn() };
    configService = {
      getOrThrow: (key: string) => (key === 'tracking.liveWindowSeconds' ? 45 : 300),
    } as unknown as ConfigService;

    service = new TrackingService(
      prisma as unknown as PrismaService,
      redis as never,
      configService,
      events as unknown as EventEmitter2,
      journeysService as unknown as JourneysService,
    );
  });

  describe('reportLocation', () => {
    it('refuses a driver reporting for a journey they do not own', async () => {
      await expect(
        service.reportLocation(
          { journeyId: 'journey-1', latitude: -26.2, longitude: 28.0 },
          asUser({ driverId: 'someone-else' }),
        ),
      ).rejects.toThrow(NotFoundDomainError);
      expect(redis.set).not.toHaveBeenCalled();
    });

    it('persists to Postgres, caches in Redis, and emits an event', async () => {
      await service.reportLocation(
        { journeyId: 'journey-1', latitude: -26.2, longitude: 28.0, speedKph: 40 },
        asUser({ driverId: 'driver-1' }),
      );

      expect(prisma.gPSLocation.create).toHaveBeenCalled();
      expect(redis.set).toHaveBeenCalledWith(
        'vehicle:latest:vehicle-1',
        expect.stringContaining('"latitude":-26.2'),
        'EX',
        1200,
      );
      expect(events.emit).toHaveBeenCalledWith(
        'tracking.locationUpdated',
        expect.objectContaining({ vehicleId: 'vehicle-1', freshness: 'LIVE' }),
      );
    });
  });

  describe('getLatestForJourney', () => {
    it('reports OFFLINE with no location when Redis has nothing cached', async () => {
      redis.get.mockResolvedValue(null);
      const result = await service.getLatestForJourney('journey-1', asUser({}));
      expect(result).toEqual({ vehicleId: 'vehicle-1', freshness: 'OFFLINE', location: null });
    });

    it('classifies a fresh cached point as LIVE', async () => {
      redis.get.mockResolvedValue(
        JSON.stringify({
          latitude: -26.2,
          longitude: 28.0,
          recordedAt: new Date().toISOString(),
          journeyId: 'journey-1',
        }),
      );
      const result = await service.getLatestForJourney('journey-1', asUser({}));
      expect(result.freshness).toBe('LIVE');
      expect(result.location?.latitude).toBe(-26.2);
    });
  });
});
