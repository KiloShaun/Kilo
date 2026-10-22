import { Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AccountsService } from '../accounts/accounts.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { Paginated, PaginationQueryDto } from '../common/dto/pagination.dto';
import { CreateDriverDto } from './dto/create-driver.dto';

@Injectable()
export class DriversService {
  constructor(
    private readonly accountsService: AccountsService,
    private readonly prisma: PrismaService,
  ) {}

  async findAll(query: PaginationQueryDto): Promise<Paginated<unknown>> {
    const where = { deletedAt: null };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.driver.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { user: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.driver.count({ where }),
    ]);
    return { data, page: query.page, pageSize: query.pageSize, total };
  }

  /** Drivers are provisioned by an admin, never self-registered — see docs/security.md. */
  async create(dto: CreateDriverDto) {
    const { user, inviteToken } = await this.accountsService.createInvitedAccount({
      email: dto.email,
      role: UserRole.DRIVER,
      firstName: dto.firstName,
      lastName: dto.lastName,
      phoneNumber: dto.phoneNumber,
      driver: { create: { licenseNumber: dto.licenseNumber } },
    });

    return {
      id: user.id,
      driverId: user.driver!.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      licenseNumber: dto.licenseNumber,
      inviteToken,
    };
  }
}
