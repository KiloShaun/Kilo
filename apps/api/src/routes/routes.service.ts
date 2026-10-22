import { Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { ConflictDomainError, NotFoundDomainError } from '../common/errors/domain-error';
import { Paginated, PaginationQueryDto } from '../common/dto/pagination.dto';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { CreateRouteDto } from './dto/create-route.dto';
import { AssignRouteDto } from './dto/assign-route.dto';
import { AssignChildToRouteDto } from './dto/assign-child-to-route.dto';

@Injectable()
export class RoutesService {
  constructor(private readonly prisma: PrismaService) {}

  /** A school admin may only ever act within their own school — see docs/security.md. */
  private assertSchoolAccess(user: AuthenticatedUser, schoolId: string) {
    if (user.role === UserRole.SCHOOL_ADMIN && user.schoolAdminSchoolId !== schoolId) {
      throw new NotFoundDomainError('School');
    }
  }

  async create(dto: CreateRouteDto, user: AuthenticatedUser) {
    this.assertSchoolAccess(user, dto.schoolId);

    return this.prisma.route.create({
      data: {
        name: dto.name,
        schoolId: dto.schoolId,
        stops: dto.stops
          ? {
              create: dto.stops.map((stop) => ({
                sequence: stop.sequence,
                name: stop.name,
                latitude: stop.latitude,
                longitude: stop.longitude,
                scheduledPickupTime: stop.scheduledPickupTime,
                scheduledDropoffTime: stop.scheduledDropoffTime,
              })),
            }
          : undefined,
      },
      include: { stops: { orderBy: { sequence: 'asc' } } },
    });
  }

  async findAll(user: AuthenticatedUser, query: PaginationQueryDto): Promise<Paginated<unknown>> {
    const where =
      user.role === UserRole.SCHOOL_ADMIN && user.schoolAdminSchoolId
        ? { schoolId: user.schoolAdminSchoolId, deletedAt: null }
        : { deletedAt: null };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.route.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { name: 'asc' },
        include: {
          stops: { orderBy: { sequence: 'asc' } },
          assignments: { where: { effectiveTo: null }, include: { driver: true, vehicle: true } },
        },
      }),
      this.prisma.route.count({ where }),
    ]);

    return { data, page: query.page, pageSize: query.pageSize, total };
  }

  async findOneScoped(id: string, user: AuthenticatedUser) {
    const route = await this.prisma.route.findFirst({
      where: { id, deletedAt: null },
      include: {
        stops: { orderBy: { sequence: 'asc' } },
        assignments: {
          where: { effectiveTo: null },
          include: {
            driver: { include: { user: true } },
            vehicle: true,
          },
        },
        childAssignments: {
          where: { deletedAt: null },
          include: { child: true, pickupStop: true },
        },
      },
    });
    if (!route) {
      throw new NotFoundDomainError('Route');
    }
    this.assertSchoolAccess(user, route.schoolId);
    return route;
  }

  /** Closes any currently-active assignment and opens a new one — a route has at most one active driver/vehicle at a time. */
  async assign(routeId: string, dto: AssignRouteDto, user: AuthenticatedUser) {
    const route = await this.findOneScoped(routeId, user);

    const [vehicle, driver] = await Promise.all([
      this.prisma.vehicle.findFirst({ where: { id: dto.vehicleId, deletedAt: null } }),
      this.prisma.driver.findFirst({ where: { id: dto.driverId, deletedAt: null } }),
    ]);
    if (!vehicle) throw new NotFoundDomainError('Vehicle');
    if (!driver) throw new NotFoundDomainError('Driver');

    return this.prisma.$transaction(async (tx) => {
      await tx.routeAssignment.updateMany({
        where: { routeId: route.id, effectiveTo: null },
        data: { effectiveTo: new Date() },
      });

      return tx.routeAssignment.create({
        data: {
          routeId: route.id,
          driverId: dto.driverId,
          vehicleId: dto.vehicleId,
        },
        include: { driver: { include: { user: true } }, vehicle: true },
      });
    });
  }

  async assignChild(routeId: string, dto: AssignChildToRouteDto, user: AuthenticatedUser) {
    const route = await this.findOneScoped(routeId, user);

    const child = await this.prisma.child.findFirst({
      where: { id: dto.childId, deletedAt: null },
    });
    if (!child) throw new NotFoundDomainError('Child');
    if (child.schoolId !== route.schoolId) {
      throw new ConflictDomainError(
        'CHILD_SCHOOL_MISMATCH',
        'This child is not enrolled at the school this route serves.',
      );
    }

    if (dto.pickupStopId && !route.stops.some((stop) => stop.id === dto.pickupStopId)) {
      throw new NotFoundDomainError('RouteStop');
    }

    const existing = await this.prisma.childRouteAssignment.findUnique({
      where: { childId_routeId: { childId: dto.childId, routeId: route.id } },
    });
    if (existing && !existing.deletedAt) {
      throw new ConflictDomainError(
        'CHILD_ALREADY_ON_ROUTE',
        'This child is already assigned to this route.',
      );
    }

    if (existing) {
      return this.prisma.childRouteAssignment.update({
        where: { id: existing.id },
        data: { deletedAt: null, pickupStopId: dto.pickupStopId ?? null },
        include: { child: true, pickupStop: true },
      });
    }

    return this.prisma.childRouteAssignment.create({
      data: { childId: dto.childId, routeId: route.id, pickupStopId: dto.pickupStopId },
      include: { child: true, pickupStop: true },
    });
  }

  async unassignChild(routeId: string, childId: string, user: AuthenticatedUser) {
    const route = await this.findOneScoped(routeId, user);
    const assignment = await this.prisma.childRouteAssignment.findUnique({
      where: { childId_routeId: { childId, routeId: route.id } },
    });
    if (!assignment || assignment.deletedAt) {
      throw new NotFoundDomainError('ChildRouteAssignment');
    }
    return this.prisma.childRouteAssignment.update({
      where: { id: assignment.id },
      data: { deletedAt: new Date() },
    });
  }
}
