import { Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { NotFoundDomainError } from '../common/errors/domain-error';
import { CreateChildDto } from './dto/create-child.dto';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';

@Injectable()
export class ChildrenService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateChildDto) {
    return this.prisma.child.create({
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
        parentId: dto.parentId,
        schoolId: dto.schoolId,
        idMethod: dto.idMethod,
        idTagValue: dto.idTagValue,
      },
    });
  }

  /**
   * Scoped lookup: a parent may only fetch their own child, a school admin only a child at
   * their school. Returns 404 (via NotFoundDomainError), not 403, for an out-of-scope id so
   * a probing request can't learn that a given child id exists elsewhere — see docs/security.md.
   */
  async findOneScoped(id: string, user: AuthenticatedUser) {
    const child = await this.prisma.child.findFirst({ where: { id, deletedAt: null } });
    if (!child) {
      throw new NotFoundDomainError('Child');
    }

    const isOwnChild = user.role === UserRole.PARENT && user.parentId === child.parentId;
    const isOwnSchool =
      user.role === UserRole.SCHOOL_ADMIN && user.schoolAdminSchoolId === child.schoolId;
    const isPlatformAdmin =
      user.role === UserRole.SUPER_ADMIN || user.role === UserRole.TRANSPORT_OPERATOR;

    if (!isOwnChild && !isOwnSchool && !isPlatformAdmin) {
      throw new NotFoundDomainError('Child');
    }

    return child;
  }

  /** A parent's own children — used by GET /parents/me/children. */
  async findAllForParent(parentId: string) {
    return this.prisma.child.findMany({
      where: { parentId, deletedAt: null },
      orderBy: { firstName: 'asc' },
    });
  }
}
