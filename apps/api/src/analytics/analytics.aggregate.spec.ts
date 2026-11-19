import { ChildJourneyStatus, EmergencyStatus, JourneyStatus } from '@prisma/client';
import { IncidentRow, JourneyRow, aggregate, enumerateDays, ratio } from './analytics.aggregate';

const FROM = new Date('2026-11-01T00:00:00.000Z');
const TO = new Date('2026-11-03T00:00:00.000Z');

let seq = 0;
function journey(overrides: Partial<JourneyRow> = {}): JourneyRow {
  seq += 1;
  return {
    id: `journey-${seq}`,
    scheduledDate: new Date('2026-11-01T00:00:00.000Z'),
    direction: 'TO_SCHOOL',
    status: JourneyStatus.SCHEDULED,
    startedAt: null,
    completedAt: null,
    route: { id: 'route-a', name: 'Route A', school: { id: 'school-1', name: 'Oak Primary' } },
    driver: { id: 'driver-1', user: { firstName: 'Thandi', lastName: 'Mokoena' } },
    vehicle: { id: 'vehicle-1', registrationNumber: 'CA 123-456' },
    childJourneys: [],
    events: [],
    emergencyIncidents: [],
    ...overrides,
  };
}

function completed(startIso: string, minutes: number, overrides: Partial<JourneyRow> = {}) {
  const startedAt = new Date(startIso);
  return journey({
    status: JourneyStatus.COMPLETED,
    startedAt,
    completedAt: new Date(startedAt.getTime() + minutes * 60_000),
    ...overrides,
  });
}

const pickedUp = (status: ChildJourneyStatus = ChildJourneyStatus.DROPPED_OFF) => ({
  status,
  actualPickupTime: new Date('2026-11-01T07:10:00.000Z'),
});
const missed = { status: ChildJourneyStatus.MISSED_PICKUP, actualPickupTime: null };
const notBoarded = { status: ChildJourneyStatus.NOT_YET_BOARDED, actualPickupTime: null };

describe('analytics aggregate', () => {
  it('returns a zero-filled report with null rates when there is no data', () => {
    const summary = aggregate([], [], FROM, TO);

    expect(summary.period).toEqual({ from: '2026-11-01', to: '2026-11-03', days: 3 });
    expect(summary.journeys.total).toBe(0);
    expect(summary.journeys.completionRate).toBeNull();
    expect(summary.journeys.avgDurationMinutes).toBeNull();
    expect(summary.children.missedPickupRate).toBeNull();
    expect(summary.emergencies.avgMinutesToAcknowledge).toBeNull();
    expect(summary.daily.map((d) => d.date)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03']);
    expect(summary.daily.every((d) => d.journeys === 0)).toBe(true);
    expect(summary.routes).toEqual([]);
    expect(summary.drivers).toEqual([]);
  });

  it('computes completion rate over terminal journeys only', () => {
    const summary = aggregate(
      [
        completed('2026-11-01T07:00:00Z', 40),
        completed('2026-11-01T14:00:00Z', 50),
        completed('2026-11-02T07:00:00Z', 45),
        journey({ status: JourneyStatus.CANCELLED }),
        journey({ status: JourneyStatus.EN_ROUTE }),
        journey({ status: JourneyStatus.SCHEDULED }),
      ],
      [],
      FROM,
      TO,
    );

    expect(summary.journeys).toMatchObject({
      total: 6,
      completed: 3,
      cancelled: 1,
      inProgress: 1,
      scheduled: 1,
      completionRate: 75,
      avgDurationMinutes: 45,
    });
  });

  it('excludes cancelled journeys from child metrics and flags unrecorded children', () => {
    const summary = aggregate(
      [
        completed('2026-11-01T07:00:00Z', 30, {
          childJourneys: [pickedUp(), pickedUp(), missed, notBoarded],
        }),
        journey({ status: JourneyStatus.CANCELLED, childJourneys: [notBoarded, notBoarded] }),
        // in progress: a not-yet-boarded child is pending, not "not recorded"
        journey({
          status: JourneyStatus.EN_ROUTE,
          childJourneys: [pickedUp(ChildJourneyStatus.ON_VEHICLE), notBoarded],
        }),
      ],
      [],
      FROM,
      TO,
    );

    expect(summary.children).toEqual({
      total: 6,
      pickedUp: 3,
      droppedOff: 2,
      missedPickups: 1,
      notRecorded: 1,
      missedPickupRate: 25,
    });
  });

  it('counts delays and SOS response times', () => {
    const triggeredAt = new Date('2026-11-01T08:00:00.000Z');
    const incidents: IncidentRow[] = [
      {
        status: EmergencyStatus.RESOLVED,
        driverId: 'driver-1',
        triggeredAt,
        acknowledgedAt: new Date(triggeredAt.getTime() + 2 * 60_000),
        resolvedAt: new Date(triggeredAt.getTime() + 30 * 60_000),
      },
      {
        status: EmergencyStatus.ACKNOWLEDGED,
        driverId: 'driver-1',
        triggeredAt,
        acknowledgedAt: new Date(triggeredAt.getTime() + 5 * 60_000),
        resolvedAt: null,
      },
      {
        status: EmergencyStatus.TRIGGERED,
        driverId: null,
        triggeredAt,
        acknowledgedAt: null,
        resolvedAt: null,
      },
    ];
    const summary = aggregate(
      [
        completed('2026-11-01T07:00:00Z', 30, { events: [{ id: 'e1' }, { id: 'e2' }] }),
        completed('2026-11-01T07:00:00Z', 30, { events: [{ id: 'e3' }] }),
        completed('2026-11-01T07:00:00Z', 30),
      ],
      incidents,
      FROM,
      TO,
    );

    expect(summary.journeys.delaysReported).toBe(3);
    expect(summary.journeys.journeysWithDelay).toBe(2);
    expect(summary.emergencies).toEqual({
      total: 3,
      byStatus: { TRIGGERED: 1, ACKNOWLEDGED: 1, RESOLVED: 1 },
      avgMinutesToAcknowledge: 3.5,
      avgMinutesToResolve: 30,
    });
    expect(summary.drivers[0].sosTriggered).toBe(2);
  });

  it('buckets journeys into days and breaks down by route and driver', () => {
    const routeB = {
      id: 'route-b',
      name: 'Route B',
      school: { id: 'school-1', name: 'Oak Primary' },
    };
    const driver2 = { id: 'driver-2', user: { firstName: 'Sipho', lastName: 'Dlamini' } };
    const summary = aggregate(
      [
        completed('2026-11-01T07:00:00Z', 40, { childJourneys: [pickedUp(), missed] }),
        completed('2026-11-02T07:00:00Z', 60, {
          scheduledDate: new Date('2026-11-02T00:00:00.000Z'),
        }),
        journey({
          scheduledDate: new Date('2026-11-03T00:00:00.000Z'),
          status: JourneyStatus.CANCELLED,
          route: routeB,
          driver: driver2,
          direction: 'FROM_SCHOOL',
        }),
      ],
      [],
      FROM,
      TO,
    );

    expect(summary.journeys.byDirection).toEqual({ TO_SCHOOL: 2, FROM_SCHOOL: 1 });
    expect(summary.daily).toEqual([
      { date: '2026-11-01', journeys: 1, completed: 1, cancelled: 0, missedPickups: 1, delays: 0 },
      { date: '2026-11-02', journeys: 1, completed: 1, cancelled: 0, missedPickups: 0, delays: 0 },
      { date: '2026-11-03', journeys: 1, completed: 0, cancelled: 1, missedPickups: 0, delays: 0 },
    ]);
    expect(summary.routes).toEqual([
      expect.objectContaining({
        routeId: 'route-a',
        journeys: 2,
        completionRate: 100,
        avgDurationMinutes: 50,
        missedPickups: 1,
        missedPickupRate: 50,
      }),
      expect.objectContaining({ routeId: 'route-b', journeys: 1, completionRate: 0 }),
    ]);
    expect(summary.drivers.map((d) => [d.driverName, d.journeys])).toEqual([
      ['Thandi Mokoena', 2],
      ['Sipho Dlamini', 1],
    ]);
  });

  it('helpers behave at the edges', () => {
    expect(ratio(0, 0)).toBeNull();
    expect(ratio(1, 3)).toBe(33.3);
    expect(enumerateDays(FROM, FROM)).toEqual(['2026-11-01']);
  });
});
