import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash } from 'crypto';
import { PrismaService } from '../common/prisma/prisma.service';
import { ConflictDomainError } from '../common/errors/domain-error';
import { parseDurationToSeconds } from '../common/utils/duration';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { BootstrapDto } from './dto/bootstrap.dto';
import { AcceptInviteDto } from './dto/accept-invite.dto';
import { AccessTokenPayload, AuthTokensResult, RefreshTokenPayload } from './auth.types';

const DEFAULT_DEVICE_ID = 'default';

@Injectable()
export class AuthService {
  private readonly accessSecret: string;
  private readonly refreshSecret: string;
  private readonly accessExpiresIn: string;
  private readonly refreshExpiresIn: string;
  private readonly saltRounds: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    this.accessSecret = this.configService.getOrThrow<string>('jwt.accessSecret');
    this.refreshSecret = this.configService.getOrThrow<string>('jwt.refreshSecret');
    this.accessExpiresIn = this.configService.get<string>('jwt.accessExpiresIn', '15m');
    this.refreshExpiresIn = this.configService.get<string>('jwt.refreshExpiresIn', '30d');
    this.saltRounds = this.configService.get<number>('security.bcryptSaltRounds', 12);
  }

  /** Self-service registration always creates a PARENT account — see docs/security.md. */
  async register(dto: RegisterDto): Promise<AuthTokensResult> {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictDomainError(
        'EMAIL_ALREADY_REGISTERED',
        'This email is already registered.',
      );
    }

    const passwordHash = await bcrypt.hash(dto.password, this.saltRounds);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        role: UserRole.PARENT,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phoneNumber: dto.phoneNumber,
        parent: { create: {} },
      },
    });

    return this.issueTokens(
      user.id,
      user.email,
      user.role,
      user.firstName,
      user.lastName,
      dto.deviceId,
    );
  }

  /**
   * Creates the platform's first SUPER_ADMIN. Every other admin action (creating schools,
   * drivers, vehicles, other admins) requires an existing SUPER_ADMIN or TRANSPORT_OPERATOR,
   * so without this endpoint a fresh deployment has no way to stand itself up. It only ever
   * works once: the check-and-create runs in a single serializable transaction so two
   * concurrent calls on an empty database can't both succeed, and it permanently refuses once
   * any user exists. There is deliberately no way to re-run it — a lost SUPER_ADMIN password
   * is recovered via direct database access, not this endpoint.
   */
  async bootstrapSuperAdmin(dto: BootstrapDto): Promise<AuthTokensResult> {
    const passwordHash = await bcrypt.hash(dto.password, this.saltRounds);

    let user;
    try {
      user = await this.prisma.$transaction(
        async (tx) => {
          const existingUserCount = await tx.user.count();
          if (existingUserCount > 0) {
            throw new ConflictDomainError(
              'BOOTSTRAP_ALREADY_COMPLETED',
              'A user already exists — the bootstrap endpoint is permanently disabled.',
            );
          }

          return tx.user.create({
            data: {
              email: dto.email,
              passwordHash,
              role: UserRole.SUPER_ADMIN,
              firstName: dto.firstName,
              lastName: dto.lastName,
              phoneNumber: dto.phoneNumber,
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      // Two concurrent bootstrap calls on an empty database: Postgres aborts one with a
      // serialization failure (Prisma error code P2034) rather than letting both succeed.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
        throw new ConflictDomainError(
          'BOOTSTRAP_ALREADY_COMPLETED',
          'The bootstrap endpoint is permanently disabled.',
        );
      }
      throw error;
    }

    return this.issueTokens(user.id, user.email, user.role, user.firstName, user.lastName);
  }

  /**
   * Sets a real password on an admin-provisioned account (DRIVER, SCHOOL_ADMIN,
   * TRANSPORT_OPERATOR — see AccountsService.createInvitedAccount) and logs the user in.
   * This is the only way such an account becomes usable.
   */
  async acceptInvite(dto: AcceptInviteDto): Promise<AuthTokensResult> {
    const tokenHash = createHash('sha256').update(dto.token).digest('hex');
    const invite = await this.prisma.accountInvite.findUnique({ where: { tokenHash } });

    if (!invite || invite.usedAt || invite.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('This invite link is invalid or has expired.');
    }

    const passwordHash = await bcrypt.hash(dto.password, this.saltRounds);

    const user = await this.prisma.$transaction(async (tx) => {
      await tx.accountInvite.update({
        where: { id: invite.id },
        data: { usedAt: new Date() },
      });
      return tx.user.update({
        where: { id: invite.userId },
        data: { passwordHash },
      });
    });

    return this.issueTokens(
      user.id,
      user.email,
      user.role,
      user.firstName,
      user.lastName,
      dto.deviceId,
    );
  }

  async login(dto: LoginDto): Promise<AuthTokensResult> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const passwordMatches = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    return this.issueTokens(
      user.id,
      user.email,
      user.role,
      user.firstName,
      user.lastName,
      dto.deviceId,
    );
  }

  async refresh(refreshToken: string): Promise<AuthTokensResult> {
    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<RefreshTokenPayload>(refreshToken, {
        secret: this.refreshSecret,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token.');
    }

    const session = await this.prisma.session.findUnique({
      where: { userId_deviceId: { userId: payload.sub, deviceId: payload.deviceId } },
    });
    if (!session || session.revokedAt) {
      throw new UnauthorizedException('Session not found or revoked.');
    }

    const tokenMatches = await bcrypt.compare(refreshToken, session.refreshTokenHash);
    if (!tokenMatches) {
      // Refresh token reuse after rotation is a strong signal of theft — revoke the session.
      await this.prisma.session.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Refresh token has already been used.');
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Account is no longer active.');
    }

    return this.issueTokens(
      user.id,
      user.email,
      user.role,
      user.firstName,
      user.lastName,
      payload.deviceId,
    );
  }

  async logout(userId: string, deviceId: string = DEFAULT_DEVICE_ID): Promise<void> {
    await this.prisma.session.updateMany({
      where: { userId, deviceId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issueTokens(
    userId: string,
    email: string,
    role: UserRole,
    firstName: string,
    lastName: string,
    deviceId: string = DEFAULT_DEVICE_ID,
  ): Promise<AuthTokensResult> {
    const accessPayload: AccessTokenPayload = { sub: userId, role };
    const refreshPayload: RefreshTokenPayload = { sub: userId, deviceId };

    const accessToken = await this.jwtService.signAsync(accessPayload, {
      secret: this.accessSecret,
      expiresIn: this.accessExpiresIn,
    });
    const refreshToken = await this.jwtService.signAsync(refreshPayload, {
      secret: this.refreshSecret,
      expiresIn: this.refreshExpiresIn,
    });

    const refreshTokenHash = await bcrypt.hash(refreshToken, this.saltRounds);

    await this.prisma.session.upsert({
      where: { userId_deviceId: { userId, deviceId } },
      create: { userId, deviceId, refreshTokenHash },
      update: { refreshTokenHash, lastSeenAt: new Date(), revokedAt: null },
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: parseDurationToSeconds(this.accessExpiresIn),
      user: { id: userId, email, role, firstName, lastName },
    };
  }
}
