import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { NotFoundDomainError } from '../common/errors/domain-error';
import { Paginated, PaginationQueryDto } from '../common/dto/pagination.dto';
import { CreateSchoolDto } from './dto/create-school.dto';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';

@Injectable()
export class SchoolsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateSchoolDto) {
    return this.prisma.school.create({ data: dto });
  }

  /** School admins only ever see their own school; other roles see every non-deleted school. */
  async findAll(user: AuthenticatedUser, query: PaginationQueryDto): Promise<Paginated<unknown>> {
    const where =
      user.role === UserRole.SCHOOL_ADMIN && user.schoolAdminSchoolId
        ? { id: user.schoolAdminSchoolId, deletedAt: null }
        : { deletedAt: null };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.school.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { name: 'asc' },
      }),
      this.prisma.school.count({ where }),
    ]);

    return { data, page: query.page, pageSize: query.pageSize, total };
  }

  async findOneScoped(id: string, user: AuthenticatedUser) {
    if (user.role === UserRole.SCHOOL_ADMIN && user.schoolAdminSchoolId !== id) {
      throw new NotFoundDomainError('School');
    }

    const school = await this.prisma.school.findFirst({ where: { id, deletedAt: null } });
    if (!school) {
      throw new NotFoundDomainError('School');
    }
    return school;
  }
}
