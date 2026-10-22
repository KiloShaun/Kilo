import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import { AccountsService } from './accounts.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { ConflictDomainError } from '../common/errors/domain-error';

describe('AccountsService', () => {
  let service: AccountsService;
  let prisma: { user: { findUnique: jest.Mock; create: jest.Mock } };

  const config = new ConfigService({
    security: { bcryptSaltRounds: 4, inviteExpiresInDays: 7 },
  });

  beforeEach(() => {
    prisma = { user: { findUnique: jest.fn(), create: jest.fn() } };
    service = new AccountsService(prisma as unknown as PrismaService, config);
  });

  it('creates an invited account with an unguessable placeholder password and returns a one-time invite token', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'driver-user-1', ...data }),
    );

    const { user, inviteToken } = await service.createInvitedAccount({
      email: 'driver@example.com',
      role: UserRole.DRIVER,
      firstName: 'John',
      lastName: 'Mokoena',
    });

    expect(user.email).toBe('driver@example.com');
    expect(inviteToken).toEqual(expect.any(String));
    expect(inviteToken.length).toBeGreaterThan(20);

    const createCall = prisma.user.create.mock.calls[0][0];
    expect(createCall.data.passwordHash).not.toBe(inviteToken);
    expect(createCall.data.accountInvite.create.tokenHash).not.toBe(inviteToken);
    expect(createCall.data.accountInvite.create.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('rejects a duplicate email', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'existing' });

    await expect(
      service.createInvitedAccount({
        email: 'taken@example.com',
        role: UserRole.DRIVER,
        firstName: 'John',
        lastName: 'Mokoena',
      }),
    ).rejects.toThrow(ConflictDomainError);
  });
});
