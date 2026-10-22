import { UserRole } from '@prisma/client';
import { RoutesService } from './routes.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { ConflictDomainError, NotFoundDomainError } from '../common/errors/domain-error';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';

interface MockPrisma {
  route: { findFirst: jest.Mock };
  child: { findFirst: jest.Mock };
  childRouteAssignment: { findUnique: jest.Mock; create: jest.Mock };
}

describe('RoutesService', () => {
  let service: RoutesService;
  let prisma: MockPrisma;

  const route = {
    id: 'route-1',
    schoolId: 'school-1',
    deletedAt: null,
    stops: [{ id: 'stop-1' }],
  };

  const asUser = (overrides: Partial<AuthenticatedUser>): AuthenticatedUser => ({
    id: 'user-1',
    email: 'user@example.com',
    role: UserRole.SUPER_ADMIN,
    ...overrides,
  });

  beforeEach(() => {
    prisma = {
      route: { findFirst: jest.fn().mockResolvedValue(route) },
      child: { findFirst: jest.fn() },
      childRouteAssignment: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'assignment-1' }),
      },
    };
    service = new RoutesService(prisma as unknown as PrismaService);
  });

  describe('findOneScoped', () => {
    it('allows a platform admin to fetch any route', async () => {
      const result = await service.findOneScoped('route-1', asUser({ role: UserRole.SUPER_ADMIN }));
      expect(result).toEqual(route);
    });

    it('denies a school admin from a different school', async () => {
      await expect(
        service.findOneScoped(
          'route-1',
          asUser({ role: UserRole.SCHOOL_ADMIN, schoolAdminSchoolId: 'other-school' }),
        ),
      ).rejects.toThrow(NotFoundDomainError);
    });

    it('allows a school admin to fetch a route at their own school', async () => {
      const result = await service.findOneScoped(
        'route-1',
        asUser({ role: UserRole.SCHOOL_ADMIN, schoolAdminSchoolId: 'school-1' }),
      );
      expect(result).toEqual(route);
    });
  });

  describe('assignChild', () => {
    it('refuses a child from a different school than the route', async () => {
      prisma.child.findFirst.mockResolvedValue({
        id: 'child-1',
        schoolId: 'different-school',
        deletedAt: null,
      });

      await expect(
        service.assignChild(
          'route-1',
          { childId: 'child-1' },
          asUser({ role: UserRole.SUPER_ADMIN }),
        ),
      ).rejects.toThrow(ConflictDomainError);
    });

    it('refuses a duplicate active assignment', async () => {
      prisma.child.findFirst.mockResolvedValue({
        id: 'child-1',
        schoolId: 'school-1',
        deletedAt: null,
      });
      prisma.childRouteAssignment.findUnique.mockResolvedValue({
        id: 'existing',
        deletedAt: null,
      });

      await expect(
        service.assignChild(
          'route-1',
          { childId: 'child-1' },
          asUser({ role: UserRole.SUPER_ADMIN }),
        ),
      ).rejects.toThrow(ConflictDomainError);
    });

    it('creates the assignment when the child belongs to the route school and is not already assigned', async () => {
      prisma.child.findFirst.mockResolvedValue({
        id: 'child-1',
        schoolId: 'school-1',
        deletedAt: null,
      });

      const result = await service.assignChild(
        'route-1',
        { childId: 'child-1', pickupStopId: 'stop-1' },
        asUser({ role: UserRole.SUPER_ADMIN }),
      );

      expect(result).toEqual({ id: 'assignment-1' });
      expect(prisma.childRouteAssignment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { childId: 'child-1', routeId: 'route-1', pickupStopId: 'stop-1' },
        }),
      );
    });

    it('rejects an unknown pickup stop id', async () => {
      prisma.child.findFirst.mockResolvedValue({
        id: 'child-1',
        schoolId: 'school-1',
        deletedAt: null,
      });

      await expect(
        service.assignChild(
          'route-1',
          { childId: 'child-1', pickupStopId: 'not-a-real-stop' },
          asUser({ role: UserRole.SUPER_ADMIN }),
        ),
      ).rejects.toThrow(NotFoundDomainError);
    });
  });
});
