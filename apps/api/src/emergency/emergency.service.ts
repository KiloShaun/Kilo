import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ChildJourneyStatus, EmergencyStatus, RecordedBy, UserRole } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { NotFoundDomainError } from '../common/errors/domain-error';
import { Paginated, PaginationQueryDto } from '../common/dto/pagination.dto';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { TriggerSosDto } from './dto/trigger-sos.dto';
import { ResolveIncidentDto } from './dto/resolve-incident.dto';
import { EmergencyEvents, EmergencyTriggeredPayload } from './emergency.events';

const INCIDENT_DETAIL_INCLUDE = {
  journey: { include: { route: { include: { school: true } }, vehicle: true } },
  timeline: { orderBy: { occurredAt: 'asc' } },
} as const;

@Injectable()
export class EmergencyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  async triggerSos(dto: TriggerSosDto, user: AuthenticatedUser) {
    const journey = await this.prisma.journey.findFirst({
      where: { id: dto.journeyId },
      include: { route: { include: { school: true } } },
    });
    if (!journey) throw new NotFoundDomainError('Journey');
    if (user.role === UserRole.DRIVER && user.driverId !== journey.driverId) {
      throw new NotFoundDomainError('Journey');
    }

    const affectedChildJourneys = await this.prisma.childJourney.findMany({
      where: { journeyId: journey.id, status: ChildJourneyStatus.ON_VEHICLE },
      include: { child: { include: { parent: true } } },
    });
    const affectedChildIds = affectedChildJourneys.map((cj) => cj.childId);

    const operators = await this.prisma.user.findMany({
      where: {
        isActive: true,
        OR: [
          { role: UserRole.SUPER_ADMIN },
          { role: UserRole.TRANSPORT_OPERATOR },
          { schoolAdminSchoolId: journey.route.schoolId },
        ],
      },
    });

    const incident = await this.prisma.$transaction(async (tx) => {
      const created = await tx.emergencyIncident.create({
        data: {
          journeyId: journey.id,
          vehicleId: journey.vehicleId,
          driverId: journey.driverId,
          affectedChildIds: affectedChildIds as never,
          latitude: dto.latitude,
          longitude: dto.longitude,
          note: dto.note,
        },
      });

      const timelineEvents: {
        eventType: 'SOS_TRIGGERED' | 'LOCATION_CAPTURED' | 'OPERATOR_NOTIFIED' | 'PARENTS_NOTIFIED';
      }[] = [{ eventType: 'SOS_TRIGGERED' }];
      if (dto.latitude !== undefined && dto.longitude !== undefined) {
        timelineEvents.push({ eventType: 'LOCATION_CAPTURED' });
      }
      timelineEvents.push({ eventType: 'OPERATOR_NOTIFIED' }, { eventType: 'PARENTS_NOTIFIED' });

      for (const timelineEvent of timelineEvents) {
        await tx.journeyEvent.create({
          data: {
            incidentId: created.id,
            journeyId: journey.id,
            eventType: timelineEvent.eventType,
            recordedBy: RecordedBy.SYSTEM,
            recordedByUserId: user.id,
            latitude: dto.latitude,
            longitude: dto.longitude,
          },
        });
      }

      return created;
    });

    const payload: EmergencyTriggeredPayload = {
      incidentId: incident.id,
      operatorUserIds: operators.map((o) => o.id),
      affectedParentUserIds: affectedChildJourneys.map((cj) => cj.child.parent.userId),
      note: dto.note ?? null,
    };
    this.events.emit(EmergencyEvents.TRIGGERED, payload);

    return this.prisma.emergencyIncident.findUnique({
      where: { id: incident.id },
      include: INCIDENT_DETAIL_INCLUDE,
    });
  }

  private async scopeWhere(user: AuthenticatedUser) {
    if (user.role === UserRole.SUPER_ADMIN || user.role === UserRole.TRANSPORT_OPERATOR) {
      return {};
    }
    if (user.role === UserRole.DRIVER && user.driverId) {
      return { driverId: user.driverId };
    }
    if (user.role === UserRole.SCHOOL_ADMIN && user.schoolAdminSchoolId) {
      return { journey: { route: { schoolId: user.schoolAdminSchoolId } } };
    }
    if (user.role === UserRole.PARENT && user.parentId) {
      const children = await this.prisma.child.findMany({
        where: { parentId: user.parentId },
        select: { id: true },
      });
      const childIds = children.map((c) => c.id);
      return {
        OR: childIds.map((childId) => ({
          affectedChildIds: { array_contains: [childId] },
        })),
      };
    }
    return { id: 'never-matches' };
  }

  async findAll(user: AuthenticatedUser, query: PaginationQueryDto): Promise<Paginated<unknown>> {
    const where = await this.scopeWhere(user);

    const [data, total] = await this.prisma.$transaction([
      this.prisma.emergencyIncident.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { triggeredAt: 'desc' },
        include: { journey: { include: { route: true, vehicle: true } } },
      }),
      this.prisma.emergencyIncident.count({ where }),
    ]);

    return { data, page: query.page, pageSize: query.pageSize, total };
  }

  async findOneScoped(id: string, user: AuthenticatedUser) {
    const incident = await this.prisma.emergencyIncident.findUnique({
      where: { id },
      include: INCIDENT_DETAIL_INCLUDE,
    });
    if (!incident) throw new NotFoundDomainError('EmergencyIncident');

    if (user.role === UserRole.SUPER_ADMIN || user.role === UserRole.TRANSPORT_OPERATOR) {
      return incident;
    }
    if (user.role === UserRole.DRIVER) {
      if (user.driverId !== incident.driverId) throw new NotFoundDomainError('EmergencyIncident');
      return incident;
    }
    if (user.role === UserRole.SCHOOL_ADMIN) {
      if (user.schoolAdminSchoolId !== incident.journey?.route.schoolId) {
        throw new NotFoundDomainError('EmergencyIncident');
      }
      return incident;
    }
    if (user.role === UserRole.PARENT && user.parentId) {
      const affectedChildIds = incident.affectedChildIds as string[];
      const ownsAffectedChild = await this.prisma.child.findFirst({
        where: { parentId: user.parentId, id: { in: affectedChildIds } },
      });
      if (!ownsAffectedChild) throw new NotFoundDomainError('EmergencyIncident');
      return incident;
    }
    throw new NotFoundDomainError('EmergencyIncident');
  }

  async acknowledge(id: string, user: AuthenticatedUser) {
    const incident = await this.findOneScoped(id, user);
    if (incident.status !== EmergencyStatus.TRIGGERED) {
      return incident; // idempotent: already acknowledged or resolved
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.emergencyIncident.update({
        where: { id },
        data: { status: EmergencyStatus.ACKNOWLEDGED, acknowledgedAt: new Date() },
      });
      await tx.journeyEvent.create({
        data: {
          incidentId: id,
          eventType: 'OPERATOR_ACKNOWLEDGED',
          recordedBy: RecordedBy.ADMIN,
          recordedByUserId: user.id,
        },
      });
    });

    return this.findOneScoped(id, user);
  }

  async resolve(id: string, dto: ResolveIncidentDto, user: AuthenticatedUser) {
    const incident = await this.findOneScoped(id, user);
    if (incident.status === EmergencyStatus.RESOLVED) {
      return incident; // idempotent
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.emergencyIncident.update({
        where: { id },
        data: {
          status: EmergencyStatus.RESOLVED,
          resolvedAt: new Date(),
          note: dto.note ?? incident.note,
        },
      });
      await tx.journeyEvent.create({
        data: {
          incidentId: id,
          eventType: 'INCIDENT_RESOLVED',
          recordedBy: RecordedBy.ADMIN,
          recordedByUserId: user.id,
          metadata: dto.note ? { note: dto.note } : undefined,
        },
      });
    });

    return this.findOneScoped(id, user);
  }
}
