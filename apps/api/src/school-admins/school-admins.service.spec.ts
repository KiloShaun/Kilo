import { UserRole } from '@prisma/client';
import { SchoolAdminsService } from './school-admins.service';
import { AccountsService } from '../accounts/accounts.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { NotFoundDomainError } from '../common/errors/domain-error';

describe('SchoolAdminsService', () => {
  let service: SchoolAdminsService;
  let accountsService: { createInvitedAccount: jest.Mock };
  let prisma: { school: { findFirst: jest.Mock } };

  beforeEach(() => {
    accountsService = { createInvitedAccount: jest.fn() };
    prisma = { school: { findFirst: jest.fn() } };
    service = new SchoolAdminsService(
      accountsService as unknown as AccountsService,
      prisma as unknown as PrismaService,
    );
  });

  it('rejects creating a school admin for a school that does not exist', async () => {
    prisma.school.findFirst.mockResolvedValue(null);

    await expect(
      service.create({
        email: 'admin@example.com',
        firstName: 'Zanele',
        lastName: 'Mbatha',
        schoolId: 'missing-school',
      }),
    ).rejects.toThrow(NotFoundDomainError);
    expect(accountsService.createInvitedAccount).not.toHaveBeenCalled();
  });

  it('scopes the new admin to the given school and returns the invite token', async () => {
    prisma.school.findFirst.mockResolvedValue({ id: 'school-1' });
    accountsService.createInvitedAccount.mockResolvedValue({
      user: {
        id: 'admin-user-1',
        email: 'admin@example.com',
        firstName: 'Zanele',
        lastName: 'Mbatha',
        role: UserRole.SCHOOL_ADMIN,
      },
      inviteToken: 'plain-invite-token',
    });

    const result = await service.create({
      email: 'admin@example.com',
      firstName: 'Zanele',
      lastName: 'Mbatha',
      schoolId: 'school-1',
    });

    expect(accountsService.createInvitedAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        role: UserRole.SCHOOL_ADMIN,
        schoolAdminOf: { connect: { id: 'school-1' } },
      }),
    );
    expect(result.inviteToken).toBe('plain-invite-token');
    expect(result.schoolId).toBe('school-1');
  });
});
