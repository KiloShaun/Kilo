import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AccessTokenPayload } from '../auth.types';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('jwt.accessSecret'),
    });
  }

  async validate(payload: AccessTokenPayload): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { parent: true, driver: true },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Account is no longer active.');
    }

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      parentId: user.parent?.id,
      driverId: user.driver?.id,
      schoolAdminSchoolId: user.schoolAdminSchoolId ?? undefined,
    };
  }
}
