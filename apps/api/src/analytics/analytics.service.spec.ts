import { UserRole } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { DomainError } from '../common/errors/domain-error';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { AnalyticsService, csvCell, resolveRange, resolveSchoolScope } from './analytics.service';

function asUser(overrides: Partial<AuthenticatedUser>): AuthenticatedUser {
  return { id: 'user-1', email: 'user@example.com', role: UserRole.SUPER_ADMIN, ...overrides };
}

describe('resolveRange', () => {
  const now = new Date('2026-11-19T15:30:00.000Z');

  it('defaults to the 30 days ending today (UTC)', () => {
    const { from, to } = resolveRange({}, now);
    expect(to.toISOString()).toBe('2026-11-19T00:00:00.000Z');
    expect(from.toISOString()).toBe('2026-10-21T00:00:00.000Z');
  });

  it('accepts an explicit range', () => {
    const { from, to } = resolveRange({ from: '2026-01-01', to: '2026-01-31' }, now);
    expect(from.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(to.toISOString()).toBe('2026-01-31T00:00:00.000Z');
  });

  it('rejects an inverted range', () => {
    expect(() => resolveRange({ from: '2026-02-01', to: '2026-01-01' }, now)).toThrow(
      expect.objectContaining({ code: 'INVALID_DATE_RANGE' }),
    );
  });

  it('rejects a range over a year', () => {
    expect(() => resolveRange({ from: '2025-01-01', to: '2026-01-02' }, now)).toThrow(DomainError);
    // exactly 366 days is allowed (a leap year's worth)
    expect(() => resolveRange({ from: '2024-01-01', to: '2024-12-31' }, now)).not.toThrow();
  });
});

describe('resolveSchoolScope', () => {
  it('lets operators choose a school or see all of them', () => {
    expect(resolveSchoolScope({}, asUser({}))).toBeUndefined();
    expect(resolveSchoolScope({ schoolId: 'school-9' }, asUser({}))).toBe('school-9');
    expect(
      resolveSchoolScope({ schoolId: 'school-9' }, asUser({ role: UserRole.TRANSPORT_OPERATOR })),
    ).toBe('school-9');
  });

  it('pins a school admin to their own school, whatever they ask for', () => {
    const admin = asUser({ role: UserRole.SCHOOL_ADMIN, schoolAdminSchoolId: 'school-1' });
    expect(resolveSchoolScope({ schoolId: 'school-9' }, admin)).toBe('school-1');
  });

  it('gives a school admin with no school an empty scope, not every school', () => {
    const scope = resolveSchoolScope({}, asUser({ role: UserRole.SCHOOL_ADMIN }));
    expect(scope).toBeDefined();
  });
});

describe('csvCell', () => {
  it('quotes delimiters and escapes quotes', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell(null)).toBe('');
    expect(csvCell(42)).toBe('42');
  });

  it('neutralises spreadsheet formulas in user-supplied text', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe('"\'=HYPERLINK(""http://x"")"');
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell(-3)).toBe('-3');
  });
});

describe('AnalyticsService', () => {
  let prisma: { journey: { findMany: jest.Mock }; emergencyIncident: { findMany: jest.Mock } };
  let service: AnalyticsService;

  beforeEach(() => {
    prisma = {
      journey: { findMany: jest.fn().mockResolvedValue([]) },
      emergencyIncident: { findMany: jest.fn().mockResolvedValue([]) },
    };
    service = new AnalyticsService(prisma as unknown as PrismaService);
  });

  it("filters a school admin's queries to their school", async () => {
    await service.summary(
      { from: '2026-11-01', to: '2026-11-07', schoolId: 'other-school' },
      asUser({ role: UserRole.SCHOOL_ADMIN, schoolAdminSchoolId: 'school-1' }),
    );

    const journeyWhere = prisma.journey.findMany.mock.calls[0][0].where;
    expect(journeyWhere.route).toEqual({ schoolId: 'school-1' });
    expect(journeyWhere.scheduledDate.gte.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(journeyWhere.scheduledDate.lte.toISOString()).toBe('2026-11-07T00:00:00.000Z');

    const incidentWhere = prisma.emergencyIncident.findMany.mock.calls[0][0].where;
    expect(incidentWhere.journey).toEqual({ route: { schoolId: 'school-1' } });
    // incidents are timestamped, so the window runs to the end of the `to` day
    expect(incidentWhere.triggeredAt.lt.toISOString()).toBe('2026-11-08T00:00:00.000Z');
  });

  it('does not filter by school for a super admin with no schoolId', async () => {
    await service.summary({ from: '2026-11-01', to: '2026-11-07' }, asUser({}));
    expect(prisma.journey.findMany.mock.calls[0][0].where.route).toBeUndefined();
    expect(prisma.emergencyIncident.findMany.mock.calls[0][0].where.journey).toBeUndefined();
  });

  it('renders one CSV row per journey with a header', async () => {
    prisma.journey.findMany.mockResolvedValue([
      {
        id: 'journey-1',
        scheduledDate: new Date('2026-11-02T00:00:00.000Z'),
        direction: 'TO_SCHOOL',
        status: 'COMPLETED',
        startedAt: new Date('2026-11-02T07:00:00.000Z'),
        completedAt: new Date('2026-11-02T07:42:30.000Z'),
        route: { id: 'r', name: 'North, Loop', school: { id: 's', name: 'Oak Primary' } },
        driver: { id: 'd', user: { firstName: 'Thandi', lastName: 'Mokoena' } },
        vehicle: { id: 'v', registrationNumber: 'CA 1' },
        childJourneys: [
          { status: 'DROPPED_OFF', actualPickupTime: new Date('2026-11-02T07:05:00.000Z') },
          { status: 'MISSED_PICKUP', actualPickupTime: null },
        ],
        events: [{ id: 'e1' }],
        emergencyIncidents: [],
      },
    ]);

    const { filename, body } = await service.journeysCsv(
      { from: '2026-11-01', to: '2026-11-07' },
      asUser({}),
    );

    expect(filename).toBe('homesafe-journeys_2026-11-01_2026-11-07.csv');
    const [header, row, trailing] = body.split('\r\n');
    expect(header.split(',')[0]).toBe('journeyId');
    expect(row).toBe(
      'journey-1,2026-11-02,TO_SCHOOL,COMPLETED,Oak Primary,"North, Loop",Thandi Mokoena,CA 1,' +
        '2026-11-02T07:00:00.000Z,2026-11-02T07:42:30.000Z,42.5,2,1,1,1,0,1,0',
    );
    expect(trailing).toBe('');
  });
});
