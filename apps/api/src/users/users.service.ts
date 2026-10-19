import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { NotFoundDomainError } from '../common/errors/domain-error';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        firstName: true,
        lastName: true,
        phoneNumber: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new NotFoundDomainError('User');
    }

    return user;
  }
}
