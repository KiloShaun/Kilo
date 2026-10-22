import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';

/**
 * Covers the full provisioning story from a completely empty database: bootstrapping the
 * first SUPER_ADMIN, then that admin provisioning a transport operator, a school admin and a
 * driver, each of whom must accept their invite before they can log in. This exercises the
 * gap identified after the initial build: only PARENT self-registration worked, and every
 * other role (including the very first admin) had no way to come into existence.
 *
 * Requires the whole `users` table empty at the start (the bootstrap endpoint only works
 * once, ever), so this file wipes all tables itself rather than relying on unique test-only
 * emails. jest-e2e.json runs e2e files with maxWorkers: 1 so this never races the other
 * e2e file against the same database.
 */
describe('Staff provisioning (e2e)', () => {
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

    await prisma.child.deleteMany();
    await prisma.accountInvite.deleteMany();
    await prisma.session.deleteMany();
    await prisma.parent.deleteMany();
    await prisma.driver.deleteMany();
    await prisma.user.deleteMany();
    await prisma.school.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  const password = 'a-very-secure-password';
  let superAdminToken: string;
  let schoolId: string;

  it('bootstraps the first SUPER_ADMIN on an empty database', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/bootstrap')
      .send({ email: 'root@homesafe.test', password, firstName: 'Root', lastName: 'Admin' })
      .expect(201);

    expect(res.body.user.role).toBe('SUPER_ADMIN');
    superAdminToken = res.body.accessToken;
  });

  it('permanently refuses a second bootstrap attempt', async () => {
    await request(app.getHttpServer())
      .post('/auth/bootstrap')
      .send({ email: 'someone-else@homesafe.test', password, firstName: 'A', lastName: 'B' })
      .expect(409);
  });

  it('lets the SUPER_ADMIN create a school (needed to scope a school admin later)', async () => {
    const res = await request(app.getHttpServer())
      .post('/schools')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ name: 'Oakwood Primary', address: '1 Oak Street' })
      .expect(201);
    schoolId = res.body.id;
  });

  it('provisions a transport operator who cannot log in until they accept their invite', async () => {
    const create = await request(app.getHttpServer())
      .post('/transport-operators')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ email: 'operator@homesafe.test', firstName: 'Zanele', lastName: 'Mbatha' })
      .expect(201);

    expect(create.body.inviteToken).toEqual(expect.any(String));

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'operator@homesafe.test', password: 'whatever-they-guess' })
      .expect(401);

    const accept = await request(app.getHttpServer())
      .post('/auth/accept-invite')
      .send({ token: create.body.inviteToken, password })
      .expect(200);

    expect(accept.body.user.role).toBe('TRANSPORT_OPERATOR');

    // The invite token is one-time use.
    await request(app.getHttpServer())
      .post('/auth/accept-invite')
      .send({ token: create.body.inviteToken, password })
      .expect(401);

    // Now the real password works.
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'operator@homesafe.test', password })
      .expect(200);
  });

  it('rejects a non-SUPER_ADMIN trying to create a transport operator', async () => {
    const driverCreate = await request(app.getHttpServer())
      .post('/drivers')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        email: 'driver-for-scope-test@homesafe.test',
        firstName: 'John',
        lastName: 'Mokoena',
        licenseNumber: 'DL-1',
      })
      .expect(201);
    const driverLogin = await request(app.getHttpServer())
      .post('/auth/accept-invite')
      .send({ token: driverCreate.body.inviteToken, password })
      .expect(200);

    await request(app.getHttpServer())
      .post('/transport-operators')
      .set('Authorization', `Bearer ${driverLogin.body.accessToken}`)
      .send({ email: 'should-not-exist@homesafe.test', firstName: 'X', lastName: 'Y' })
      .expect(403);
  });

  it('provisions a school admin scoped to a specific school', async () => {
    const create = await request(app.getHttpServer())
      .post('/school-admins')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ email: 'admin@homesafe.test', firstName: 'Naledi', lastName: 'Khumalo', schoolId })
      .expect(201);

    const accept = await request(app.getHttpServer())
      .post('/auth/accept-invite')
      .send({ token: create.body.inviteToken, password })
      .expect(200);

    expect(accept.body.user.role).toBe('SCHOOL_ADMIN');
  });

  it('rejects a school admin for a school that does not exist', async () => {
    await request(app.getHttpServer())
      .post('/school-admins')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        email: 'admin2@homesafe.test',
        firstName: 'A',
        lastName: 'B',
        schoolId: '00000000-0000-0000-0000-000000000000',
      })
      .expect(404);
  });
});
