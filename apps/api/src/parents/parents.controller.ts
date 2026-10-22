import { Controller, ForbiddenException, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ChildrenService } from '../children/children.service';
import { ParentsService } from './parents.service';
import { ListParentsQueryDto } from './dto/list-parents-query.dto';

@ApiTags('parents')
@ApiBearerAuth()
@Controller('parents')
export class ParentsController {
  constructor(
    private readonly childrenService: ChildrenService,
    private readonly parentsService: ParentsService,
  ) {}

  @Get('me/children')
  children(@CurrentUser() user: AuthenticatedUser) {
    if (!user.parentId) {
      throw new ForbiddenException('This account is not a parent account.');
    }
    return this.childrenService.findAllForParent(user.parentId);
  }

  /** Lets an admin find a parent's internal id (by email) before enrolling their child — see ParentsService. */
  @Get()
  @Roles(UserRole.SUPER_ADMIN, UserRole.TRANSPORT_OPERATOR, UserRole.SCHOOL_ADMIN)
  findAll(@Query() query: ListParentsQueryDto) {
    return this.parentsService.findAll(query, query.email);
  }
}
