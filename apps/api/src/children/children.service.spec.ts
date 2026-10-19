import { UserRole } from '@prisma/client';
import { ChildrenService } from './children.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { NotFoundDomainError } from '../common/errors/domain-error';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';

describe('ChildrenService', () => {
  let service: ChildrenService;
  let prisma: { child: { findFirst: jest.Mock } };

  const child = {
    id: 'child-1',
    parentId: 'parent-1',
    schoolId: 'school-1',
    deletedAt: null,
  };

  beforeEach(() => {
    prisma = { child: { findFirst: jest.fn().mockResolvedValue(child) } };
    service = new ChildrenService(prisma as unknown as PrismaService);
  });

  const asUser = (overrides: Partial<AuthenticatedUser>): AuthenticatedUser => ({
    id: 'user-1',
    email: 'user@example.com',
    role: UserRole.PARENT,
    ...overrides,
  });

  it('allows a parent to fetch their own child', async () => {
    const result = await service.findOneScoped(
      'child-1',
      asUser({ role: UserRole.PARENT, parentId: 'parent-1' }),
    );
    expect(result).toEqual(child);
  });

  it('returns 404 (not 403) when a parent requests a child that is not theirs', async () => {
    await expect(
      service.findOneScoped('child-1', asUser({ role: UserRole.PARENT, parentId: 'someone-else' })),
    ).rejects.toThrow(NotFoundDomainError);
  });

  it('allows a school admin to fetch a child at their own school', async () => {
    const result = await service.findOneScoped(
      'child-1',
      asUser({ role: UserRole.SCHOOL_ADMIN, schoolAdminSchoolId: 'school-1' }),
    );
    expect(result).toEqual(child);
  });

  it('denies a school admin from a different school', async () => {
    await expect(
      service.findOneScoped(
        'child-1',
        asUser({ role: UserRole.SCHOOL_ADMIN, schoolAdminSchoolId: 'other-school' }),
      ),
    ).rejects.toThrow(NotFoundDomainError);
  });

  it('allows SUPER_ADMIN unrestricted access', async () => {
    const result = await service.findOneScoped('child-1', asUser({ role: UserRole.SUPER_ADMIN }));
    expect(result).toEqual(child);
  });

  it('returns 404 when the child does not exist at all', async () => {
    prisma.child.findFirst.mockResolvedValue(null);
    await expect(
      service.findOneScoped('missing-child', asUser({ role: UserRole.SUPER_ADMIN })),
    ).rejects.toThrow(NotFoundDomainError);
  });
});
