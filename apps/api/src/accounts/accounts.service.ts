import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Driver, Parent, Prisma, User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomBytes, createHash } from 'crypto';
import { PrismaService } from '../common/prisma/prisma.service';
import { ConflictDomainError } from '../common/errors/domain-error';

export interface InvitedAccountResult {
  user: User & { driver: Driver | null; parent: Parent | null };
  /**
   * The one-time plaintext invite token. Only the caller (an authenticated admin) ever sees
   * this — only its SHA-256 hash is persisted. Until a real email/SMS provider is wired up
   * (see docs/mvp-roadmap.md), the admin is responsible for relaying it to the invitee
   * out of band (e.g. reading it back from this response and messaging it to them).
   */
  inviteToken: string;
}

/**
 * Creates admin-provisioned accounts (DRIVER, SCHOOL_ADMIN, TRANSPORT_OPERATOR) that cannot
 * self-register (see docs/security.md). The account is created with an unusable placeholder
 * password and a one-time invite token; the invitee calls POST /auth/accept-invite with that
 * token to set their real password, which is the only way the account becomes usable.
 */
@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async createInvitedAccount(
    userCreateData: Omit<Prisma.UserCreateInput, 'passwordHash' | 'accountInvite'>,
  ): Promise<InvitedAccountResult> {
    const email = userCreateData.email;
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictDomainError(
        'EMAIL_ALREADY_REGISTERED',
        'This email is already registered.',
      );
    }

    const saltRounds = this.configService.get<number>('security.bcryptSaltRounds', 12);
    const placeholderSecret = randomBytes(24).toString('base64url');
    const passwordHash = await bcrypt.hash(placeholderSecret, saltRounds);

    const inviteToken = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(inviteToken).digest('hex');
    const expiresInDays = this.configService.get<number>('security.inviteExpiresInDays', 7);
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

    const user = await this.prisma.user.create({
      data: {
        ...userCreateData,
        passwordHash,
        accountInvite: { create: { tokenHash, expiresAt } },
      },
      include: { driver: true, parent: true },
    });

    return { user, inviteToken };
  }
}
