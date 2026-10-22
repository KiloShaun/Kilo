import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash } from 'crypto';
import { AuthService } from './auth.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { ConflictDomainError } from '../common/errors/domain-error';

describe('AuthService', () => {
  let authService: AuthService;
  let prisma: {
    user: { findUnique: jest.Mock; create: jest.Mock; count: jest.Mock; update: jest.Mock };
    session: { findUnique: jest.Mock; upsert: jest.Mock; update: jest.Mock; updateMany: jest.Mock };
    accountInvite: { findUnique: jest.Mock; update: jest.Mock };
    $transaction: jest.Mock;
  };
  let jwtService: { signAsync: jest.Mock; verifyAsync: jest.Mock };

  const config = new ConfigService({
    jwt: {
      accessSecret: 'test-access-secret',
      refreshSecret: 'test-refresh-secret',
      accessExpiresIn: '15m',
      refreshExpiresIn: '30d',
    },
    security: { bcryptSaltRounds: 4 },
  });

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn(), create: jest.fn(), count: jest.fn(), update: jest.fn() },
      session: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      accountInvite: { findUnique: jest.fn(), update: jest.fn() },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(prisma)),
    };
    jwtService = { signAsync: jest.fn(), verifyAsync: jest.fn() };

    authService = new AuthService(
      prisma as unknown as PrismaService,
      jwtService as unknown as JwtService,
      config,
    );
  });

  describe('register', () => {
    it('creates a PARENT account and returns a token pair', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({
        id: 'user-1',
        email: 'parent@example.com',
        role: UserRole.PARENT,
        firstName: 'Jane',
        lastName: 'Doe',
      });
      jwtService.signAsync
        .mockResolvedValueOnce('access-token')
        .mockResolvedValueOnce('refresh-token');
      prisma.session.upsert.mockResolvedValue({});

      const result = await authService.register({
        email: 'parent@example.com',
        password: 'supersecurepassword',
        firstName: 'Jane',
        lastName: 'Doe',
      });

      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ role: UserRole.PARENT, parent: { create: {} } }),
        }),
      );
      expect(result.accessToken).toBe('access-token');
      expect(result.user.role).toBe(UserRole.PARENT);
    });

    it('rejects registration with an email that is already taken', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'existing-user' });

      await expect(
        authService.register({
          email: 'taken@example.com',
          password: 'supersecurepassword',
          firstName: 'Jane',
          lastName: 'Doe',
        }),
      ).rejects.toThrow(ConflictDomainError);
    });
  });

  describe('login', () => {
    it('rejects an unknown email without revealing whether the account exists', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        authService.login({ email: 'nobody@example.com', password: 'whatever' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a wrong password', async () => {
      const passwordHash = await bcrypt.hash('correct-password', 4);
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'parent@example.com',
        passwordHash,
        role: UserRole.PARENT,
        isActive: true,
        firstName: 'Jane',
        lastName: 'Doe',
      });

      await expect(
        authService.login({ email: 'parent@example.com', password: 'wrong-password' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('issues tokens for correct credentials', async () => {
      const passwordHash = await bcrypt.hash('correct-password', 4);
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'parent@example.com',
        passwordHash,
        role: UserRole.PARENT,
        isActive: true,
        firstName: 'Jane',
        lastName: 'Doe',
      });
      jwtService.signAsync
        .mockResolvedValueOnce('access-token')
        .mockResolvedValueOnce('refresh-token');
      prisma.session.upsert.mockResolvedValue({});

      const result = await authService.login({
        email: 'parent@example.com',
        password: 'correct-password',
      });

      expect(result.accessToken).toBe('access-token');
      expect(result.refreshToken).toBe('refresh-token');
    });
  });

  describe('refresh', () => {
    it('revokes the session and rejects when a refresh token is reused after rotation', async () => {
      jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1', deviceId: 'device-1' });
      const staleHash = await bcrypt.hash('a-different-refresh-token', 4);
      prisma.session.findUnique.mockResolvedValue({
        id: 'session-1',
        userId: 'user-1',
        deviceId: 'device-1',
        refreshTokenHash: staleHash,
        revokedAt: null,
      });

      await expect(authService.refresh('reused-refresh-token')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(prisma.session.update).toHaveBeenCalledWith({
        where: { id: 'session-1' },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('rejects a refresh token for a session that no longer exists', async () => {
      jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1', deviceId: 'device-1' });
      prisma.session.findUnique.mockResolvedValue(null);

      await expect(authService.refresh('some-token')).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('bootstrapSuperAdmin', () => {
    it('creates a SUPER_ADMIN when no user exists yet', async () => {
      prisma.user.count.mockResolvedValue(0);
      prisma.user.create.mockResolvedValue({
        id: 'admin-1',
        email: 'admin@example.com',
        role: UserRole.SUPER_ADMIN,
        firstName: 'Ada',
        lastName: 'Lovelace',
      });
      jwtService.signAsync
        .mockResolvedValueOnce('access-token')
        .mockResolvedValueOnce('refresh-token');
      prisma.session.upsert.mockResolvedValue({});

      const result = await authService.bootstrapSuperAdmin({
        email: 'admin@example.com',
        password: 'supersecurepassword',
        firstName: 'Ada',
        lastName: 'Lovelace',
      });

      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ role: UserRole.SUPER_ADMIN }) }),
      );
      expect(result.user.role).toBe(UserRole.SUPER_ADMIN);
    });

    it('permanently refuses once any user already exists', async () => {
      prisma.user.count.mockResolvedValue(1);

      await expect(
        authService.bootstrapSuperAdmin({
          email: 'second-admin@example.com',
          password: 'supersecurepassword',
          firstName: 'Ada',
          lastName: 'Lovelace',
        }),
      ).rejects.toThrow(ConflictDomainError);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });
  });

  describe('acceptInvite', () => {
    it('sets the password on a valid, unused, unexpired invite and logs the user in', async () => {
      const token = 'a-valid-invite-token';
      const tokenHash = createHash('sha256').update(token).digest('hex');
      prisma.accountInvite.findUnique.mockResolvedValue({
        id: 'invite-1',
        userId: 'driver-user-1',
        tokenHash,
        usedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      });
      prisma.user.update.mockResolvedValue({
        id: 'driver-user-1',
        email: 'driver@example.com',
        role: UserRole.DRIVER,
        firstName: 'John',
        lastName: 'Mokoena',
      });
      jwtService.signAsync
        .mockResolvedValueOnce('access-token')
        .mockResolvedValueOnce('refresh-token');
      prisma.session.upsert.mockResolvedValue({});

      const result = await authService.acceptInvite({ token, password: 'a-new-password123' });

      expect(prisma.accountInvite.update).toHaveBeenCalledWith({
        where: { id: 'invite-1' },
        data: { usedAt: expect.any(Date) },
      });
      expect(result.accessToken).toBe('access-token');
    });

    it('rejects an unknown invite token', async () => {
      prisma.accountInvite.findUnique.mockResolvedValue(null);

      await expect(
        authService.acceptInvite({ token: 'nonexistent', password: 'a-new-password123' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an already-used invite token', async () => {
      prisma.accountInvite.findUnique.mockResolvedValue({
        id: 'invite-1',
        userId: 'driver-user-1',
        usedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      });

      await expect(
        authService.acceptInvite({ token: 'already-used', password: 'a-new-password123' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an expired invite token', async () => {
      prisma.accountInvite.findUnique.mockResolvedValue({
        id: 'invite-1',
        userId: 'driver-user-1',
        usedAt: null,
        expiresAt: new Date(Date.now() - 60_000),
      });

      await expect(
        authService.acceptInvite({ token: 'expired', password: 'a-new-password123' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
