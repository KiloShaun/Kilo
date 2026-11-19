import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { DomainError } from '../common/errors/domain-error';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';
import {
  AnalyticsSummary,
  JourneyRow,
  aggregate,
  childCountsFor,
  durationMinutes,
  toDateKey,
} from './analytics.aggregate';

export const DEFAULT_RANGE_DAYS = 30;
export const MAX_RANGE_DAYS = 366;
const MS_PER_DAY = 86_400_000;

const JOURNEY_ANALYTICS_SELECT = {
  id: true,
  scheduledDate: true,
  direction: true,
  status: true,
  startedAt: true,
  completedAt: true,
  route: { select: { id: true, name: true, school: { select: { id: true, name: true } } } },
  driver: { select: { id: true, user: { select: { firstName: true, lastName: true } } } },
  vehicle: { select: { id: true, registrationNumber: true } },
  childJourneys: { select: { status: true, actualPickupTime: true } },
  events: { where: { eventType: 'VEHICLE_DELAYED' }, select: { id: true } },
  emergencyIncidents: { select: { id: true } },
} satisfies Prisma.JourneySelect;

export interface ResolvedRange {
  from: Date;
  to: Date;
}

function parseDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export function resolveRange(query: AnalyticsQueryDto, now: Date = new Date()): ResolvedRange {
  const to = query.to ? parseDateOnly(query.to) : parseDateOnly(toDateKey(now));
  const from = query.from
    ? parseDateOnly(query.from)
    : new Date(to.getTime() - (DEFAULT_RANGE_DAYS - 1) * MS_PER_DAY);

  if (from.getTime() > to.getTime()) {
    throw new DomainError('INVALID_DATE_RANGE', '`from` must be on or before `to`.');
  }
  const days = Math.round((to.getTime() - from.getTime()) / MS_PER_DAY) + 1;
  if (days > MAX_RANGE_DAYS) {
    throw new DomainError(
      'DATE_RANGE_TOO_LARGE',
      `A report can cover at most ${MAX_RANGE_DAYS} days; this one covers ${days}.`,
      HttpStatus.BAD_REQUEST,
    );
  }
  return { from, to };
}

/**
 * The school a report is restricted to, or undefined for "every school". A SCHOOL_ADMIN is
 * pinned to their own school whatever they pass — the same rule every other module applies.
 */
export function resolveSchoolScope(
  query: AnalyticsQueryDto,
  user: AuthenticatedUser,
): string | undefined {
  if (user.role === UserRole.SCHOOL_ADMIN) {
    // An admin without a school sees nothing rather than everything.
    return user.schoolAdminSchoolId ?? '00000000-0000-0000-0000-000000000000';
  }
  return query.schoolId;
}

const CSV_COLUMNS = [
  'journeyId',
  'date',
  'direction',
  'status',
  'school',
  'route',
  'driver',
  'vehicle',
  'startedAt',
  'completedAt',
  'durationMinutes',
  'children',
  'pickedUp',
  'droppedOff',
  'missedPickups',
  'notRecorded',
  'delaysReported',
  'sosTriggered',
] as const;

/**
 * RFC 4180 quoting, plus a guard against spreadsheet formula injection: route, school and
 * driver names are user-supplied, and a cell starting with = + - @ would be evaluated by
 * Excel/Sheets when an admin opens the export.
 */
export function csvCell(value: string | number | null): string {
  if (value === null) return '';
  let text = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  private async fetchJourneys(range: ResolvedRange, schoolId: string | undefined) {
    const rows = await this.prisma.journey.findMany({
      where: {
        scheduledDate: { gte: range.from, lte: range.to },
        ...(schoolId ? { route: { schoolId } } : {}),
      },
      select: JOURNEY_ANALYTICS_SELECT,
      orderBy: [{ scheduledDate: 'asc' }, { createdAt: 'asc' }],
    });
    return rows as JourneyRow[];
  }

  async summary(query: AnalyticsQueryDto, user: AuthenticatedUser): Promise<AnalyticsSummary> {
    const range = resolveRange(query);
    const schoolId = resolveSchoolScope(query, user);

    const [journeys, incidents] = await Promise.all([
      this.fetchJourneys(range, schoolId),
      this.prisma.emergencyIncident.findMany({
        where: {
          triggeredAt: { gte: range.from, lt: new Date(range.to.getTime() + MS_PER_DAY) },
          ...(schoolId ? { journey: { route: { schoolId } } } : {}),
        },
        select: {
          status: true,
          driverId: true,
          triggeredAt: true,
          acknowledgedAt: true,
          resolvedAt: true,
        },
      }),
    ]);

    return aggregate(journeys, incidents, range.from, range.to);
  }

  async journeysCsv(
    query: AnalyticsQueryDto,
    user: AuthenticatedUser,
  ): Promise<{ filename: string; body: string }> {
    const range = resolveRange(query);
    const schoolId = resolveSchoolScope(query, user);
    const journeys = await this.fetchJourneys(range, schoolId);

    const lines = [CSV_COLUMNS.join(',')];
    for (const journey of journeys) {
      const children = childCountsFor(journey);
      const duration = durationMinutes(journey);
      const cells: (string | number | null)[] = [
        journey.id,
        toDateKey(journey.scheduledDate),
        journey.direction,
        journey.status,
        journey.route.school.name,
        journey.route.name,
        `${journey.driver.user.firstName} ${journey.driver.user.lastName}`,
        journey.vehicle.registrationNumber,
        journey.startedAt?.toISOString() ?? null,
        journey.completedAt?.toISOString() ?? null,
        duration === null ? null : Math.round(duration * 10) / 10,
        children.total,
        children.pickedUp,
        children.droppedOff,
        children.missedPickups,
        children.notRecorded,
        journey.events.length,
        journey.emergencyIncidents.length,
      ];
      lines.push(cells.map(csvCell).join(','));
    }

    return {
      filename: `homesafe-journeys_${toDateKey(range.from)}_${toDateKey(range.to)}.csv`,
      body: `${lines.join('\r\n')}\r\n`,
    };
  }
}
