import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { Paginated, PaginationQueryDto } from '../common/dto/pagination.dto';

@Injectable()
export class ParentsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lets an admin look up a parent's internal id (needed to enrol their child) by email —
   * there is no other way to discover it, since a parent's own id is only ever resolved
   * server-side from their JWT for their own requests.
   */
  async findAll(query: PaginationQueryDto, emailContains?: string): Promise<Paginated<unknown>> {
    const where = emailContains
      ? {
          deletedAt: null,
          user: { email: { contains: emailContains, mode: 'insensitive' as const } },
        }
      : { deletedAt: null };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.parent.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { user: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.parent.count({ where }),
    ]);

    return { data, page: query.page, pageSize: query.pageSize, total };
  }
}
