import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { Audited } from '../common/decorators/audited.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ChildrenService } from './children.service';
import { CreateChildDto } from './dto/create-child.dto';

@ApiTags('children')
@ApiBearerAuth()
@Controller('children')
export class ChildrenController {
  constructor(private readonly childrenService: ChildrenService) {}

  @Post()
  @Roles(UserRole.SUPER_ADMIN, UserRole.TRANSPORT_OPERATOR, UserRole.SCHOOL_ADMIN)
  @Audited('CHILD_CREATED')
  create(@Body() dto: CreateChildDto) {
    return this.childrenService.create(dto);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.childrenService.findOneScoped(id, user);
  }
}
