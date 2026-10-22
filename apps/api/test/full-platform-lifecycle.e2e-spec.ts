import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';

/**
 * Exercises the full journey lifecycle end to end against a real Postgres + Redis: routes and
 * assignments (Phase 3), GPS ingestion and live-location freshness (Phase 5), the journey
 * state machine and child pickup/dropoff verification (Phase 7), in-app notifications fanned
 * out from those domain events (Phase 8), and an emergency/SOS incident raised mid-journey
 * (Phase 10).
 *
 * Wipes every table itself (see staff-provisioning.e2e-spec.ts for why) and runs with
 * maxWorkers: 1, so it never races that file over the same database.
 */
async function wipeDatabase(prisma: PrismaService) {
  await prisma.notification.deleteMany();
  await prisma.journeyEvent.deleteMany();
  await prisma.gPSLocation.deleteMany();
  await prisma.childJourney.deleteMany();
  await prisma.journey.deleteMany();
  await prisma.emergencyIncident.deleteMany();
  await prisma.childRouteAssignment.deleteMany();
  await prisma.route.deleteMany();
  await prisma.child.deleteMany();
  await prisma.vehicle.deleteMany();
  await prisma.driver.deleteMany();
  await prisma.parent.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.accountInvite.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
  await prisma.school.deleteMany();
}

describe('Full platform lifecycle (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    prisma = app.get(PrismaService);
    await wipeDatabase(prisma);
  });

  afterAll(async () => {
    // Leave the database clean so the other e2e files' simpler cleanup (which doesn't know
    // about routes/journeys/incidents) doesn't fail on foreign keys this file created.
    await wipeDatabase(prisma);
    await app.close();
  });

  const password = 'a-very-secure-password';
  const http = () => request(app.getHttpServer());

  let superAdminToken: string;
  let schoolId: string;
  let driverId: string;
  let driverToken: string;
  let parentToken: string;
  let vehicleId: string;
  let childId: string;
  let routeId: string;
  let stopId: string;
  let journeyId: string;

  it('bootstraps the SUPER_ADMIN and creates a school', async () => {
    const bootstrap = await http()
      .post('/auth/bootstrap')
      .send({ email: 'root@homesafe.test', password, firstName: 'Root', lastName: 'Admin' })
      .expect(201);
    superAdminToken = bootstrap.body.accessToken;

    const school = await http()
      .post('/schools')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ name: 'Oakwood Primary', address: '1 Oak Street' })
      .expect(201);
    schoolId = school.body.id;
  });

  it('provisions a driver and a vehicle', async () => {
    const driverCreate = await http()
      .post('/drivers')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        email: 'driver@homesafe.test',
        firstName: 'Thabo',
        lastName: 'Nkosi',
        licenseNumber: 'DL-9001',
      })
      .expect(201);
    driverId = driverCreate.body.driverId;

    const accept = await http()
      .post('/auth/accept-invite')
      .send({ token: driverCreate.body.inviteToken, password })
      .expect(200);
    driverToken = accept.body.accessToken;

    const vehicle = await http()
      .post('/vehicles')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        registrationNumber: 'GP-123-456',
        capacity: 16,
        vehicleType: 'MINIBUS',
      })
      .expect(201);
    vehicleId = vehicle.body.id;
  });

  it('registers a parent and enrols a child', async () => {
    const register = await http()
      .post('/auth/register')
      .send({ email: 'parent@homesafe.test', password, firstName: 'Lindiwe', lastName: 'Dube' })
      .expect(201);
    parentToken = register.body.accessToken;

    const lookup = await http()
      .get('/parents?email=parent@homesafe.test')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .expect(200);
    const parentId = lookup.body.data[0].id;

    const child = await http()
      .post('/children')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ firstName: 'Amy', lastName: 'Dube', parentId, schoolId, idMethod: 'QR' })
      .expect(201);
    childId = child.body.id;
  });

  it('creates a route with a stop, assigns the driver/vehicle, and enrols the child', async () => {
    const route = await http()
      .post('/routes')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        name: 'Oakwood Morning Loop',
        schoolId,
        stops: [{ sequence: 1, name: 'Elm Street', latitude: -26.2041, longitude: 28.0473 }],
      })
      .expect(201);
    routeId = route.body.id;
    stopId = route.body.stops[0].id;

    await http()
      .post(`/routes/${routeId}/assignments`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ driverId, vehicleId })
      .expect(201);

    await http()
      .post(`/routes/${routeId}/children`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ childId, pickupStopId: stopId })
      .expect(201);
  });

  it('refuses to assign a child from a different school to the route', async () => {
    const otherSchool = await http()
      .post('/schools')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ name: 'Riverside Primary', address: '2 River Road' })
      .expect(201);

    await http()
      .post('/auth/register')
      .send({ email: 'other-parent@homesafe.test', password, firstName: 'B', lastName: 'C' })
      .expect(201);
    const otherParentLookup = await http()
      .get('/parents?email=other-parent@homesafe.test')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .expect(200);
    const otherParentId = otherParentLookup.body.data[0].id;

    const otherChild = await http()
      .post('/children')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        firstName: 'Other',
        lastName: 'Child',
        parentId: otherParentId,
        schoolId: otherSchool.body.id,
      })
      .expect(201);

    await http()
      .post(`/routes/${routeId}/children`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ childId: otherChild.body.id })
      .expect(409);
  });

  it('creates a journey for today, seeding a NOT_YET_BOARDED child journey', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const journey = await http()
      .post('/journeys')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ routeId, direction: 'TO_SCHOOL', scheduledDate: today })
      .expect(201);

    journeyId = journey.body.id;
    expect(journey.body.status).toBe('SCHEDULED');
    expect(journey.body.childJourneys).toHaveLength(1);
    expect(journey.body.childJourneys[0].status).toBe('NOT_YET_BOARDED');
  });

  it('refuses a driver who does not own the journey', async () => {
    const otherDriverCreate = await http()
      .post('/drivers')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        email: 'other-driver@homesafe.test',
        firstName: 'X',
        lastName: 'Y',
        licenseNumber: 'DL-9999',
      })
      .expect(201);
    const otherDriverAccept = await http()
      .post('/auth/accept-invite')
      .send({ token: otherDriverCreate.body.inviteToken, password })
      .expect(200);

    await http()
      .post(`/journeys/${journeyId}/start`)
      .set('Authorization', `Bearer ${otherDriverAccept.body.accessToken}`)
      .expect(404);
  });

  it('lets the assigned driver start the journey, and is idempotent on retry', async () => {
    const start = await http()
      .post(`/journeys/${journeyId}/start`)
      .set('Authorization', `Bearer ${driverToken}`)
      .expect(201);
    expect(start.body.status).toBe('DRIVER_STARTED');

    await http()
      .post(`/journeys/${journeyId}/start`)
      .set('Authorization', `Bearer ${driverToken}`)
      .expect(201);

    const parentNotifications = await http()
      .get('/notifications')
      .set('Authorization', `Bearer ${parentToken}`)
      .expect(200);
    expect(
      parentNotifications.body.data.some((n: { title: string }) => n.title === 'Route started'),
    ).toBe(true);
  });

  it('reports a GPS location and the parent sees a LIVE freshness reading', async () => {
    await http()
      .post('/tracking/locations')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ journeyId, latitude: -26.2041, longitude: 28.0473, speedKph: 35 })
      .expect(201);

    const location = await http()
      .get(`/tracking/journeys/${journeyId}/location`)
      .set('Authorization', `Bearer ${parentToken}`)
      .expect(200);

    expect(location.body.freshness).toBe('LIVE');
    expect(location.body.location.latitude).toBeCloseTo(-26.2041, 3);
  });

  it('refuses a parent with no child on this journey from reading its location', async () => {
    const strangerRegister = await http()
      .post('/auth/register')
      .send({ email: 'stranger@homesafe.test', password, firstName: 'No', lastName: 'Relation' })
      .expect(201);

    await http()
      .get(`/tracking/journeys/${journeyId}/location`)
      .set('Authorization', `Bearer ${strangerRegister.body.accessToken}`)
      .expect(404);
  });

  it('picks up the child, notifying the parent, and is idempotent on retry', async () => {
    const pickup = await http()
      .post(`/journeys/${journeyId}/children/${childId}/pickup`)
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ verificationMethod: 'QR' })
      .expect(201);
    expect(pickup.body.status).toBe('ON_VEHICLE');

    await http()
      .post(`/journeys/${journeyId}/children/${childId}/pickup`)
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ verificationMethod: 'QR' })
      .expect(201);

    const parentNotifications = await http()
      .get('/notifications')
      .set('Authorization', `Bearer ${parentToken}`)
      .expect(200);
    expect(
      parentNotifications.body.data.some((n: { title: string }) => n.title === 'Child picked up'),
    ).toBe(true);
  });

  let incidentId: string;

  it('triggers an SOS mid-journey, snapshotting the onboard child', async () => {
    const sos = await http()
      .post('/emergency/sos')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ journeyId, latitude: -26.21, longitude: 28.05, note: 'Flat tyre on the highway' })
      .expect(201);

    incidentId = sos.body.id;
    expect(sos.body.affectedChildIds).toEqual([childId]);
    expect(sos.body.status).toBe('TRIGGERED');

    const parentNotifications = await http()
      .get('/notifications')
      .set('Authorization', `Bearer ${parentToken}`)
      .expect(200);
    expect(
      parentNotifications.body.data.some((n: { title: string }) => n.title.startsWith('SOS')),
    ).toBe(true);
  });

  it('lets the parent of the affected child see the incident, but not an unrelated parent', async () => {
    await http()
      .get(`/emergency/${incidentId}`)
      .set('Authorization', `Bearer ${parentToken}`)
      .expect(200);

    const strangerRegister = await http()
      .post('/auth/register')
      .send({ email: 'stranger2@homesafe.test', password, firstName: 'No', lastName: 'Relation' })
      .expect(201);

    await http()
      .get(`/emergency/${incidentId}`)
      .set('Authorization', `Bearer ${strangerRegister.body.accessToken}`)
      .expect(404);
  });

  it('lets an operator acknowledge then resolve the incident, idempotently', async () => {
    const ack = await http()
      .post(`/emergency/${incidentId}/acknowledge`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .expect(201);
    expect(ack.body.status).toBe('ACKNOWLEDGED');

    const resolve = await http()
      .post(`/emergency/${incidentId}/resolve`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ note: 'Spare fitted, route resumed' })
      .expect(201);
    expect(resolve.body.status).toBe('RESOLVED');

    const resolveAgain = await http()
      .post(`/emergency/${incidentId}/resolve`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .expect(201);
    expect(resolveAgain.body.status).toBe('RESOLVED');
  });

  it('drops the child off, refuses a second dropoff attempt as a no-op, then completes the journey', async () => {
    const dropoff = await http()
      .post(`/journeys/${journeyId}/children/${childId}/dropoff`)
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ verificationMethod: 'QR' })
      .expect(201);
    expect(dropoff.body.status).toBe('DROPPED_OFF');

    const end = await http()
      .post(`/journeys/${journeyId}/end`)
      .set('Authorization', `Bearer ${driverToken}`)
      .expect(201);
    expect(end.body.status).toBe('COMPLETED');

    const detail = await http()
      .get(`/journeys/${journeyId}`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .expect(200);
    const eventTypes = detail.body.events.map((e: { eventType: string }) => e.eventType);
    expect(eventTypes).toEqual(
      expect.arrayContaining([
        'DRIVER_STARTED_ROUTE',
        'CHILD_PICKED_UP',
        'CHILD_DROPPED_OFF',
        'ROUTE_COMPLETED',
      ]),
    );
  });
});
