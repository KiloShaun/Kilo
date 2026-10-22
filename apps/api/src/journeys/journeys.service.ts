import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ChildJourneyStatus, JourneyStatus, RecordedBy, UserRole } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { ConflictDomainError, NotFoundDomainError } from '../common/errors/domain-error';
import { Paginated, PaginationQueryDto } from '../common/dto/pagination.dto';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { CreateJourneyDto } from './dto/create-journey.dto';
import { VerifyChildDto } from './dto/verify-child.dto';
import { ReportDelayDto } from './dto/report-delay.dto';
import {
  JourneyEvents,
  JourneyStartedPayload,
  JourneyDelayedPayload,
  JourneyCompletedPayload,
  ChildJourneyPayload,
} from './journey.events';

const JOURNEY_DETAIL_INCLUDE = {
  route: { include: { school: true, stops: { orderBy: { sequence: 'asc' } } } },
  vehicle: true,
  driver: { include: { user: true } },
  childJourneys: { include: { child: true } },
  events: { orderBy: { occurredAt: 'asc' } },
} as const;

@Injectable()
export class JourneysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  async create(dto: CreateJourneyDto, user: AuthenticatedUser) {
    const route = await this.prisma.route.findFirst({
      where: { id: dto.routeId, deletedAt: null },
      include: {
        school: true,
        assignments: { where: { effectiveTo: null } },
        childAssignments: { where: { deletedAt: null } },
      },
    });
    if (!route) throw new NotFoundDomainError('Route');

    if (user.role === UserRole.SCHOOL_ADMIN && user.schoolAdminSchoolId !== route.schoolId) {
      throw new NotFoundDomainError('Route');
    }

    const activeAssignment = route.assignments[0];
    if (!activeAssignment) {
      throw new ConflictDomainError(
        'ROUTE_HAS_NO_ACTIVE_ASSIGNMENT',
        'This route has no driver/vehicle currently assigned.',
      );
    }

    const scheduledDate = new Date(dto.scheduledDate);

    return this.prisma.journey.create({
      data: {
        routeId: route.id,
        vehicleId: activeAssignment.vehicleId,
        driverId: activeAssignment.driverId,
        direction: dto.direction,
        scheduledDate,
        childJourneys: {
          create: route.childAssignments.map((assignment) => ({
            childId: assignment.childId,
            status: ChildJourneyStatus.NOT_YET_BOARDED,
          })),
        },
      },
      include: JOURNEY_DETAIL_INCLUDE,
    });
  }

  async findAll(user: AuthenticatedUser, query: PaginationQueryDto): Promise<Paginated<unknown>> {
    const where = await this.scopeWhere(user);

    const [data, total] = await this.prisma.$transaction([
      this.prisma.journey.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { scheduledDate: 'desc' },
        include: {
          route: { include: { school: true } },
          vehicle: true,
          driver: { include: { user: true } },
        },
      }),
      this.prisma.journey.count({ where }),
    ]);

    return { data, page: query.page, pageSize: query.pageSize, total };
  }

  private async scopeWhere(user: AuthenticatedUser) {
    if (user.role === UserRole.SUPER_ADMIN || user.role === UserRole.TRANSPORT_OPERATOR) {
      return {};
    }
    if (user.role === UserRole.DRIVER && user.driverId) {
      return { driverId: user.driverId };
    }
    if (user.role === UserRole.SCHOOL_ADMIN && user.schoolAdminSchoolId) {
      return { route: { schoolId: user.schoolAdminSchoolId } };
    }
    if (user.role === UserRole.PARENT && user.parentId) {
      return { childJourneys: { some: { child: { parentId: user.parentId } } } };
    }
    return { id: 'never-matches' };
  }

  async findOneScoped(id: string, user: AuthenticatedUser) {
    const journey = await this.prisma.journey.findFirst({
      where: { id },
      include: JOURNEY_DETAIL_INCLUDE,
    });
    if (!journey) throw new NotFoundDomainError('Journey');

    const allowed = await this.isVisibleTo(journey, user);
    if (!allowed) throw new NotFoundDomainError('Journey');

    return journey;
  }

  private async isVisibleTo(
    journey: {
      driverId: string;
      route: { schoolId: string };
      childJourneys: { childId: string }[];
    },
    user: AuthenticatedUser,
  ): Promise<boolean> {
    if (user.role === UserRole.SUPER_ADMIN || user.role === UserRole.TRANSPORT_OPERATOR) {
      return true;
    }
    if (user.role === UserRole.DRIVER) {
      return user.driverId === journey.driverId;
    }
    if (user.role === UserRole.SCHOOL_ADMIN) {
      return user.schoolAdminSchoolId === journey.route.schoolId;
    }
    if (user.role === UserRole.PARENT && user.parentId) {
      const ownsAChild = await this.prisma.child.findFirst({
        where: {
          parentId: user.parentId,
          id: { in: journey.childJourneys.map((cj) => cj.childId) },
        },
      });
      return !!ownsAChild;
    }
    return false;
  }

  /** Only the journey's assigned driver may drive its lifecycle — see docs/security.md. */
  private async assertDriverOwnsJourney(journeyId: string, user: AuthenticatedUser) {
    const journey = await this.prisma.journey.findFirst({
      where: { id: journeyId },
      include: { route: true },
    });
    if (!journey) throw new NotFoundDomainError('Journey');
    if (user.role !== UserRole.DRIVER || user.driverId !== journey.driverId) {
      throw new NotFoundDomainError('Journey');
    }
    return journey;
  }

  async start(journeyId: string, user: AuthenticatedUser) {
    const journey = await this.assertDriverOwnsJourney(journeyId, user);

    if (journey.status !== JourneyStatus.SCHEDULED) {
      if (journey.status === JourneyStatus.DRIVER_STARTED) {
        return journey; // idempotent: already started
      }
      throw new ConflictDomainError(
        'JOURNEY_CANNOT_BE_STARTED',
        `Journey is already in status ${journey.status}.`,
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.journey.update({
        where: { id: journeyId },
        data: { status: JourneyStatus.DRIVER_STARTED, startedAt: new Date() },
      });
      await tx.journeyEvent.create({
        data: {
          journeyId,
          eventType: 'DRIVER_STARTED_ROUTE',
          recordedBy: RecordedBy.DRIVER,
          recordedByUserId: user.id,
        },
      });
      return result;
    });

    const payload: JourneyStartedPayload = {
      journeyId,
      routeId: journey.routeId,
      routeName: journey.route.name,
      driverId: journey.driverId,
    };
    this.events.emit(JourneyEvents.STARTED, payload);

    return updated;
  }

  async reportDelay(journeyId: string, dto: ReportDelayDto, user: AuthenticatedUser) {
    const journey = await this.assertDriverOwnsJourney(journeyId, user);

    await this.prisma.journeyEvent.create({
      data: {
        journeyId,
        eventType: 'VEHICLE_DELAYED',
        recordedBy: RecordedBy.DRIVER,
        recordedByUserId: user.id,
        metadata: { reason: dto.reason },
      },
    });

    const payload: JourneyDelayedPayload = { journeyId, reason: dto.reason };
    this.events.emit(JourneyEvents.DELAYED, payload);

    return journey;
  }

  async end(journeyId: string, user: AuthenticatedUser) {
    const journey = await this.assertDriverOwnsJourney(journeyId, user);

    if (journey.status === JourneyStatus.COMPLETED) {
      return journey; // idempotent
    }
    if (journey.status === JourneyStatus.CANCELLED) {
      throw new ConflictDomainError('JOURNEY_CANCELLED', 'This journey was cancelled.');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.journey.update({
        where: { id: journeyId },
        data: { status: JourneyStatus.COMPLETED, completedAt: new Date() },
      });
      await tx.journeyEvent.create({
        data: {
          journeyId,
          eventType: 'ROUTE_COMPLETED',
          recordedBy: RecordedBy.DRIVER,
          recordedByUserId: user.id,
        },
      });
      return result;
    });

    const payload: JourneyCompletedPayload = { journeyId, routeId: journey.routeId };
    this.events.emit(JourneyEvents.COMPLETED, payload);

    return updated;
  }

  async cancel(journeyId: string, user: AuthenticatedUser) {
    const journey = await this.assertDriverOwnsJourney(journeyId, user);
    if (journey.status === JourneyStatus.COMPLETED) {
      throw new ConflictDomainError(
        'JOURNEY_COMPLETED',
        'A completed journey cannot be cancelled.',
      );
    }
    return this.prisma.journey.update({
      where: { id: journeyId },
      data: { status: JourneyStatus.CANCELLED },
    });
  }

  private async getChildJourneyOrThrow(journeyId: string, childId: string) {
    const childJourney = await this.prisma.childJourney.findUnique({
      where: { journeyId_childId: { journeyId, childId } },
      include: { child: { include: { parent: true } }, journey: { include: { route: true } } },
    });
    if (!childJourney) throw new NotFoundDomainError('ChildJourney');
    return childJourney;
  }

  /** Idempotent: tapping the same child's tag twice in quick succession is a no-op, not an error. */
  async pickupChild(
    journeyId: string,
    childId: string,
    dto: VerifyChildDto,
    user: AuthenticatedUser,
  ) {
    await this.assertDriverOwnsJourney(journeyId, user);
    const childJourney = await this.getChildJourneyOrThrow(journeyId, childId);

    if (childJourney.status === ChildJourneyStatus.ON_VEHICLE) {
      return childJourney;
    }
    if (
      childJourney.status === ChildJourneyStatus.ARRIVED_AT_SCHOOL ||
      childJourney.status === ChildJourneyStatus.DROPPED_OFF
    ) {
      throw new ConflictDomainError(
        'CHILD_ALREADY_PROGRESSED',
        'This child has already moved past pickup for this journey.',
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.childJourney.update({
        where: { id: childJourney.id },
        data: { status: ChildJourneyStatus.ON_VEHICLE, actualPickupTime: new Date() },
        include: { child: true },
      });
      await tx.journeyEvent.create({
        data: {
          journeyId,
          childId,
          eventType: 'CHILD_PICKED_UP',
          recordedBy: RecordedBy.DRIVER,
          recordedByUserId: user.id,
          verificationMethod: dto.verificationMethod,
          latitude: dto.latitude,
          longitude: dto.longitude,
        },
      });
      return result;
    });

    const payload: ChildJourneyPayload = {
      journeyId,
      routeId: childJourney.journey.routeId,
      childId,
      childFirstName: childJourney.child.firstName,
      parentUserId: childJourney.child.parent.userId,
    };
    this.events.emit(JourneyEvents.CHILD_PICKED_UP, payload);

    return updated;
  }

  async dropoffChild(
    journeyId: string,
    childId: string,
    dto: VerifyChildDto,
    user: AuthenticatedUser,
  ) {
    await this.assertDriverOwnsJourney(journeyId, user);
    const childJourney = await this.getChildJourneyOrThrow(journeyId, childId);

    if (childJourney.status === ChildJourneyStatus.DROPPED_OFF) {
      return childJourney;
    }
    if (childJourney.status !== ChildJourneyStatus.ON_VEHICLE) {
      throw new ConflictDomainError(
        'CHILD_NOT_ON_VEHICLE',
        'This child must be picked up before they can be dropped off.',
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.childJourney.update({
        where: { id: childJourney.id },
        data: { status: ChildJourneyStatus.DROPPED_OFF, actualDropoffTime: new Date() },
        include: { child: true },
      });
      await tx.journeyEvent.create({
        data: {
          journeyId,
          childId,
          eventType: 'CHILD_DROPPED_OFF',
          recordedBy: RecordedBy.DRIVER,
          recordedByUserId: user.id,
          verificationMethod: dto.verificationMethod,
          latitude: dto.latitude,
          longitude: dto.longitude,
        },
      });
      return result;
    });

    const payload: ChildJourneyPayload = {
      journeyId,
      routeId: childJourney.journey.routeId,
      childId,
      childFirstName: childJourney.child.firstName,
      parentUserId: childJourney.child.parent.userId,
    };
    this.events.emit(JourneyEvents.CHILD_DROPPED_OFF, payload);

    return updated;
  }

  async missedPickup(journeyId: string, childId: string, user: AuthenticatedUser) {
    await this.assertDriverOwnsJourney(journeyId, user);
    const childJourney = await this.getChildJourneyOrThrow(journeyId, childId);

    if (childJourney.status !== ChildJourneyStatus.NOT_YET_BOARDED) {
      throw new ConflictDomainError(
        'CHILD_ALREADY_PROGRESSED',
        'This child has already been picked up or progressed past pickup.',
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.childJourney.update({
        where: { id: childJourney.id },
        data: { status: ChildJourneyStatus.MISSED_PICKUP },
        include: { child: true },
      });
      await tx.journeyEvent.create({
        data: {
          journeyId,
          childId,
          eventType: 'CHILD_MISSED_PICKUP',
          recordedBy: RecordedBy.DRIVER,
          recordedByUserId: user.id,
        },
      });
      return result;
    });

    const payload: ChildJourneyPayload = {
      journeyId,
      routeId: childJourney.journey.routeId,
      childId,
      childFirstName: childJourney.child.firstName,
      parentUserId: childJourney.child.parent.userId,
    };
    this.events.emit(JourneyEvents.CHILD_MISSED_PICKUP, payload);

    return updated;
  }
}
