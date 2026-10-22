import { Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { NotFoundDomainError } from '../common/errors/domain-error';
import { AccountsService } from '../accounts/accounts.service';
import { CreateSchoolAdminDto } from './dto/create-school-admin.dto';

@Injectable()
export class SchoolAdminsService {
  constructor(
    private readonly accountsService: AccountsService,
    private readonly prisma: PrismaService,
  ) {}

  async create(dto: CreateSchoolAdminDto) {
    const school = await this.prisma.school.findFirst({
      where: { id: dto.schoolId, deletedAt: null },
    });
    if (!school) {
      throw new NotFoundDomainError('School');
    }

    const { user, inviteToken } = await this.accountsService.createInvitedAccount({
      email: dto.email,
      role: UserRole.SCHOOL_ADMIN,
      firstName: dto.firstName,
      lastName: dto.lastName,
      phoneNumber: dto.phoneNumber,
      schoolAdminOf: { connect: { id: dto.schoolId } },
    });

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      schoolId: dto.schoolId,
      inviteToken,
    };
  }
}
