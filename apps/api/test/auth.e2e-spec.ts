import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';

describe('Auth + scoping (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.child.deleteMany();
    await prisma.parent.deleteMany();
    await prisma.session.deleteMany();
    await prisma.user.deleteMany({ where: { email: { endsWith: '@e2e.homesafe.test' } } });
    await app.close();
  });

  const parentAEmail = 'parent-a@e2e.homesafe.test';
  const parentBEmail = 'parent-b@e2e.homesafe.test';
  const password = 'a-very-secure-password';

  it('registers a new parent and returns a token pair', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: parentAEmail, password, firstName: 'Parent', lastName: 'A' })
      .expect(201);

    expect(res.body.accessToken).toBeDefined();
    expect(res.body.user.role).toBe('PARENT');
  });

  it('rejects a public registration payload that tries to smuggle a privileged role', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: 'attempted-admin@e2e.homesafe.test',
        password,
        firstName: 'Sneaky',
        lastName: 'User',
        role: 'SUPER_ADMIN',
      })
      .expect(400); // forbidNonWhitelisted rejects the unexpected `role` field outright
  });

  it('logs the parent back in', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: parentAEmail, password })
      .expect(200);

    expect(res.body.accessToken).toBeDefined();
  });

  it('rejects an unauthenticated request to a protected route', async () => {
    await request(app.getHttpServer()).get('/users/me').expect(401);
  });

  it("prevents parent A from reading parent B's child", async () => {
    const [loginA, loginB] = await Promise.all([
      request(app.getHttpServer()).post('/auth/login').send({ email: parentAEmail, password }),
      request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: parentBEmail, password, firstName: 'Parent', lastName: 'B' }),
    ]);

    const school = await prisma.school.create({
      data: { name: 'E2E Test School', address: '1 Test Street' },
    });
    const parentB = await prisma.parent.findUniqueOrThrow({
      where: { userId: loginB.body.user.id },
    });
    const childOfB = await prisma.child.create({
      data: { firstName: 'Child', lastName: 'Of B', parentId: parentB.id, schoolId: school.id },
    });

    // Parent B can read their own child.
    await request(app.getHttpServer())
      .get(`/children/${childOfB.id}`)
      .set('Authorization', `Bearer ${loginB.body.accessToken}`)
      .expect(200);

    // Parent A cannot — and gets 404, not 403, so existence isn't confirmed either way.
    await request(app.getHttpServer())
      .get(`/children/${childOfB.id}`)
      .set('Authorization', `Bearer ${loginA.body.accessToken}`)
      .expect(404);
  });
});
