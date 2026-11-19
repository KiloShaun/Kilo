import {
  ChildJourneyStatus,
  EmergencyStatus,
  JourneyDirection,
  JourneyStatus,
} from '@prisma/client';

/**
 * Pure aggregation for Phase 11 analytics. Kept free of Prisma/Nest so every metric's
 * definition is unit-testable against hand-built rows — the service only fetches and scopes.
 *
 * Metric definitions (also documented in docs/api-spec.yaml):
 * - completionRate: completed / (completed + cancelled) — i.e. of journeys that reached a
 *   terminal state, how many ran to completion. Journeys still scheduled or in progress are
 *   reported separately and excluded, so a busy "today" doesn't drag the rate down.
 * - avgDurationMinutes: mean of completedAt − startedAt over completed journeys that have both.
 * - child metrics count only journeys that weren't cancelled (a cancelled run's children were
 *   never going to be picked up, so counting them would inflate "not recorded").
 * - missedPickupRate: missed / (pickedUp + missed) — of pickups with a recorded outcome.
 * - notRecorded: children still NOT_YET_BOARDED on a COMPLETED journey — the driver ended the
 *   route without marking them either way. A data-quality signal, not a safety event.
 * - SOS response times: mean minutes from triggeredAt to acknowledgedAt / resolvedAt, over the
 *   incidents that have that timestamp.
 *
 * Deliberately absent: on-time %. ChildJourney.scheduledPickupTime is never populated and
 * RouteStop times are "HH:mm" with no timezone on the route, so any on-time figure would be
 * a guess presented as a measurement.
 */

export interface JourneyRow {
  id: string;
  scheduledDate: Date;
  direction: JourneyDirection;
  status: JourneyStatus;
  startedAt: Date | null;
  completedAt: Date | null;
  route: { id: string; name: string; school: { id: string; name: string } };
  driver: { id: string; user: { firstName: string; lastName: string } };
  vehicle: { id: string; registrationNumber: string };
  childJourneys: { status: ChildJourneyStatus; actualPickupTime: Date | null }[];
  events: { id: string }[]; // VEHICLE_DELAYED events only
  emergencyIncidents: { id: string }[];
}

export interface IncidentRow {
  status: EmergencyStatus;
  driverId: string | null;
  triggeredAt: Date;
  acknowledgedAt: Date | null;
  resolvedAt: Date | null;
}

export interface ChildCounts {
  total: number;
  pickedUp: number;
  droppedOff: number;
  missedPickups: number;
  notRecorded: number;
}

interface JourneyCounts {
  total: number;
  completed: number;
  cancelled: number;
  inProgress: number;
  scheduled: number;
}

export interface AnalyticsSummary {
  period: { from: string; to: string; days: number };
  journeys: JourneyCounts & {
    completionRate: number | null;
    avgDurationMinutes: number | null;
    byDirection: Record<JourneyDirection, number>;
    delaysReported: number;
    journeysWithDelay: number;
  };
  children: ChildCounts & { missedPickupRate: number | null };
  emergencies: {
    total: number;
    byStatus: Record<EmergencyStatus, number>;
    avgMinutesToAcknowledge: number | null;
    avgMinutesToResolve: number | null;
  };
  daily: {
    date: string;
    journeys: number;
    completed: number;
    cancelled: number;
    missedPickups: number;
    delays: number;
  }[];
  routes: {
    routeId: string;
    routeName: string;
    schoolId: string;
    schoolName: string;
    journeys: number;
    completed: number;
    cancelled: number;
    completionRate: number | null;
    avgDurationMinutes: number | null;
    delays: number;
    missedPickups: number;
    missedPickupRate: number | null;
  }[];
  drivers: {
    driverId: string;
    driverName: string;
    journeys: number;
    completed: number;
    avgDurationMinutes: number | null;
    delays: number;
    missedPickups: number;
    sosTriggered: number;
  }[];
}

const IN_PROGRESS_STATUSES = new Set<JourneyStatus>([
  JourneyStatus.DRIVER_STARTED,
  JourneyStatus.EN_ROUTE,
  JourneyStatus.PICKUP,
  JourneyStatus.CHILD_ONBOARD,
  JourneyStatus.SCHOOL_ARRIVAL,
  JourneyStatus.SCHOOL_DROPOFF,
  JourneyStatus.RETURN_ROUTE,
  JourneyStatus.CHILD_DROPPED_OFF,
]);

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

export function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Every YYYY-MM-DD from `from` to `to` inclusive (both already UTC midnights). */
export function enumerateDays(from: Date, to: Date): string[] {
  const days: string[] = [];
  for (let t = from.getTime(); t <= to.getTime(); t += MS_PER_DAY) {
    days.push(toDateKey(new Date(t)));
  }
  return days;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : round1((numerator / denominator) * 100);
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return round1(values.reduce((sum, v) => sum + v, 0) / values.length);
}

export function durationMinutes(journey: Pick<JourneyRow, 'status' | 'startedAt' | 'completedAt'>) {
  if (journey.status !== JourneyStatus.COMPLETED || !journey.startedAt || !journey.completedAt) {
    return null;
  }
  return (journey.completedAt.getTime() - journey.startedAt.getTime()) / MS_PER_MINUTE;
}

export function childCountsFor(journey: Pick<JourneyRow, 'status' | 'childJourneys'>): ChildCounts {
  const counts: ChildCounts = {
    total: 0,
    pickedUp: 0,
    droppedOff: 0,
    missedPickups: 0,
    notRecorded: 0,
  };
  if (journey.status === JourneyStatus.CANCELLED) return counts;

  for (const cj of journey.childJourneys) {
    counts.total += 1;
    if (cj.actualPickupTime) counts.pickedUp += 1;
    if (cj.status === ChildJourneyStatus.DROPPED_OFF) counts.droppedOff += 1;
    if (cj.status === ChildJourneyStatus.MISSED_PICKUP) counts.missedPickups += 1;
    if (
      cj.status === ChildJourneyStatus.NOT_YET_BOARDED &&
      journey.status === JourneyStatus.COMPLETED
    ) {
      counts.notRecorded += 1;
    }
  }
  return counts;
}

function emptyJourneyCounts(): JourneyCounts {
  return { total: 0, completed: 0, cancelled: 0, inProgress: 0, scheduled: 0 };
}

function tallyJourney(counts: JourneyCounts, status: JourneyStatus) {
  counts.total += 1;
  if (status === JourneyStatus.COMPLETED) counts.completed += 1;
  else if (status === JourneyStatus.CANCELLED) counts.cancelled += 1;
  else if (status === JourneyStatus.SCHEDULED) counts.scheduled += 1;
  else if (IN_PROGRESS_STATUSES.has(status)) counts.inProgress += 1;
}

export function aggregate(
  journeys: JourneyRow[],
  incidents: IncidentRow[],
  from: Date,
  to: Date,
): AnalyticsSummary {
  const totals = emptyJourneyCounts();
  const byDirection: Record<JourneyDirection, number> = { TO_SCHOOL: 0, FROM_SCHOOL: 0 };
  const durations: number[] = [];
  let delaysReported = 0;
  let journeysWithDelay = 0;
  const children: ChildCounts = {
    total: 0,
    pickedUp: 0,
    droppedOff: 0,
    missedPickups: 0,
    notRecorded: 0,
  };

  const days = enumerateDays(from, to);
  const daily = new Map(
    days.map((date) => [
      date,
      { date, journeys: 0, completed: 0, cancelled: 0, missedPickups: 0, delays: 0 },
    ]),
  );

  const routes = new Map<
    string,
    {
      routeId: string;
      routeName: string;
      schoolId: string;
      schoolName: string;
      counts: JourneyCounts;
      durations: number[];
      delays: number;
      pickedUp: number;
      missedPickups: number;
    }
  >();

  const drivers = new Map<
    string,
    {
      driverId: string;
      driverName: string;
      counts: JourneyCounts;
      durations: number[];
      delays: number;
      missedPickups: number;
      sosTriggered: number;
    }
  >();

  for (const journey of journeys) {
    tallyJourney(totals, journey.status);
    byDirection[journey.direction] += 1;

    const duration = durationMinutes(journey);
    if (duration !== null) durations.push(duration);

    const delays = journey.events.length;
    delaysReported += delays;
    if (delays > 0) journeysWithDelay += 1;

    const childCounts = childCountsFor(journey);
    children.total += childCounts.total;
    children.pickedUp += childCounts.pickedUp;
    children.droppedOff += childCounts.droppedOff;
    children.missedPickups += childCounts.missedPickups;
    children.notRecorded += childCounts.notRecorded;

    const day = daily.get(toDateKey(journey.scheduledDate));
    if (day) {
      day.journeys += 1;
      if (journey.status === JourneyStatus.COMPLETED) day.completed += 1;
      if (journey.status === JourneyStatus.CANCELLED) day.cancelled += 1;
      day.missedPickups += childCounts.missedPickups;
      day.delays += delays;
    }

    let route = routes.get(journey.route.id);
    if (!route) {
      route = {
        routeId: journey.route.id,
        routeName: journey.route.name,
        schoolId: journey.route.school.id,
        schoolName: journey.route.school.name,
        counts: emptyJourneyCounts(),
        durations: [],
        delays: 0,
        pickedUp: 0,
        missedPickups: 0,
      };
      routes.set(journey.route.id, route);
    }
    tallyJourney(route.counts, journey.status);
    if (duration !== null) route.durations.push(duration);
    route.delays += delays;
    route.pickedUp += childCounts.pickedUp;
    route.missedPickups += childCounts.missedPickups;

    let driver = drivers.get(journey.driver.id);
    if (!driver) {
      driver = {
        driverId: journey.driver.id,
        driverName: `${journey.driver.user.firstName} ${journey.driver.user.lastName}`,
        counts: emptyJourneyCounts(),
        durations: [],
        delays: 0,
        missedPickups: 0,
        sosTriggered: 0,
      };
      drivers.set(journey.driver.id, driver);
    }
    tallyJourney(driver.counts, journey.status);
    if (duration !== null) driver.durations.push(duration);
    driver.delays += delays;
    driver.missedPickups += childCounts.missedPickups;
  }

  const byStatus: Record<EmergencyStatus, number> = { TRIGGERED: 0, ACKNOWLEDGED: 0, RESOLVED: 0 };
  const ackMinutes: number[] = [];
  const resolveMinutes: number[] = [];
  for (const incident of incidents) {
    byStatus[incident.status] += 1;
    if (incident.acknowledgedAt) {
      ackMinutes.push(
        (incident.acknowledgedAt.getTime() - incident.triggeredAt.getTime()) / MS_PER_MINUTE,
      );
    }
    if (incident.resolvedAt) {
      resolveMinutes.push(
        (incident.resolvedAt.getTime() - incident.triggeredAt.getTime()) / MS_PER_MINUTE,
      );
    }
    const driver = incident.driverId ? drivers.get(incident.driverId) : undefined;
    if (driver) driver.sosTriggered += 1;
  }

  return {
    period: { from: toDateKey(from), to: toDateKey(to), days: days.length },
    journeys: {
      ...totals,
      completionRate: ratio(totals.completed, totals.completed + totals.cancelled),
      avgDurationMinutes: mean(durations),
      byDirection,
      delaysReported,
      journeysWithDelay,
    },
    children: {
      ...children,
      missedPickupRate: ratio(children.missedPickups, children.pickedUp + children.missedPickups),
    },
    emergencies: {
      total: incidents.length,
      byStatus,
      avgMinutesToAcknowledge: mean(ackMinutes),
      avgMinutesToResolve: mean(resolveMinutes),
    },
    daily: [...daily.values()],
    routes: [...routes.values()]
      .map((r) => ({
        routeId: r.routeId,
        routeName: r.routeName,
        schoolId: r.schoolId,
        schoolName: r.schoolName,
        journeys: r.counts.total,
        completed: r.counts.completed,
        cancelled: r.counts.cancelled,
        completionRate: ratio(r.counts.completed, r.counts.completed + r.counts.cancelled),
        avgDurationMinutes: mean(r.durations),
        delays: r.delays,
        missedPickups: r.missedPickups,
        missedPickupRate: ratio(r.missedPickups, r.pickedUp + r.missedPickups),
      }))
      .sort((a, b) => b.journeys - a.journeys || a.routeName.localeCompare(b.routeName)),
    drivers: [...drivers.values()]
      .map((d) => ({
        driverId: d.driverId,
        driverName: d.driverName,
        journeys: d.counts.total,
        completed: d.counts.completed,
        avgDurationMinutes: mean(d.durations),
        delays: d.delays,
        missedPickups: d.missedPickups,
        sosTriggered: d.sosTriggered,
      }))
      .sort((a, b) => b.journeys - a.journeys || a.driverName.localeCompare(b.driverName)),
  };
}
