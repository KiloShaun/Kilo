import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { UserRole } from '@prisma/client';
import type { Redis } from 'ioredis';
import { PrismaService } from '../common/prisma/prisma.service';
import { NotFoundDomainError } from '../common/errors/domain-error';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { REDIS_CLIENT } from '../common/redis/redis.constants';
import { JourneysService } from '../journeys/journeys.service';
import { ReportLocationDto } from './dto/report-location.dto';
import { classifyFreshness, LocationFreshness } from './location-freshness';

export const TRACKING_LOCATION_UPDATED_EVENT = 'tracking.locationUpdated';

export interface LocationUpdatedPayload {
  journeyId: string;
  vehicleId: string;
  latitude: number;
  longitude: number;
  speedKph?: number;
  recordedAt: string;
  freshness: LocationFreshness;
}

export interface LatestLocationResult {
  vehicleId: string;
  freshness: LocationFreshness;
  location: {
    latitude: number;
    longitude: number;
    accuracyMeters?: number;
    speedKph?: number;
    recordedAt: string;
  } | null;
}

interface CachedLocation {
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
  speedKph?: number;
  recordedAt: string;
  journeyId: string;
}

@Injectable()
export class TrackingService {
  private readonly liveWindowSeconds: number;
  private readonly staleWindowSeconds: number;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly configService: ConfigService,
    private readonly events: EventEmitter2,
    private readonly journeysService: JourneysService,
  ) {
    this.liveWindowSeconds = this.configService.getOrThrow<number>('tracking.liveWindowSeconds');
    this.staleWindowSeconds = this.configService.getOrThrow<number>('tracking.staleWindowSeconds');
  }

  private redisKey(vehicleId: string): string {
    return `vehicle:latest:${vehicleId}`;
  }

  async reportLocation(dto: ReportLocationDto, user: AuthenticatedUser) {
    const journey = await this.prisma.journey.findFirst({ where: { id: dto.journeyId } });
    if (!journey) throw new NotFoundDomainError('Journey');
    if (user.role !== UserRole.DRIVER || user.driverId !== journey.driverId) {
      throw new NotFoundDomainError('Journey');
    }

    const recordedAt = dto.recordedAt ? new Date(dto.recordedAt) : new Date();

    const [gpsLocation] = await Promise.all([
      this.prisma.gPSLocation.create({
        data: {
          vehicleId: journey.vehicleId,
          journeyId: journey.id,
          latitude: dto.latitude,
          longitude: dto.longitude,
          accuracyMeters: dto.accuracyMeters,
          speedKph: dto.speedKph,
          recordedAt,
        },
      }),
      this.redis.set(
        this.redisKey(journey.vehicleId),
        JSON.stringify({
          latitude: dto.latitude,
          longitude: dto.longitude,
          accuracyMeters: dto.accuracyMeters,
          speedKph: dto.speedKph,
          recordedAt: recordedAt.toISOString(),
          journeyId: journey.id,
        } satisfies CachedLocation),
        'EX',
        this.staleWindowSeconds * 4,
      ),
    ]);

    const payload: LocationUpdatedPayload = {
      journeyId: journey.id,
      vehicleId: journey.vehicleId,
      latitude: dto.latitude,
      longitude: dto.longitude,
      speedKph: dto.speedKph,
      recordedAt: recordedAt.toISOString(),
      freshness: 'LIVE',
    };
    this.events.emit(TRACKING_LOCATION_UPDATED_EVENT, payload);

    return gpsLocation;
  }

  async getLatestForJourney(
    journeyId: string,
    user: AuthenticatedUser,
  ): Promise<LatestLocationResult> {
    const journey = await this.journeysService.findOneScoped(journeyId, user);

    const raw = await this.redis.get(this.redisKey(journey.vehicleId));
    if (!raw) {
      return { vehicleId: journey.vehicleId, freshness: 'OFFLINE', location: null };
    }

    const cached = JSON.parse(raw) as CachedLocation;
    const freshness = classifyFreshness(
      new Date(cached.recordedAt),
      new Date(),
      this.liveWindowSeconds,
      this.staleWindowSeconds,
    );

    return {
      vehicleId: journey.vehicleId,
      freshness,
      location: {
        latitude: cached.latitude,
        longitude: cached.longitude,
        accuracyMeters: cached.accuracyMeters,
        speedKph: cached.speedKph,
        recordedAt: cached.recordedAt,
      },
    };
  }
}
