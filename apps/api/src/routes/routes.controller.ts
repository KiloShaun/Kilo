import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { Audited } from '../common/decorators/audited.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import { RoutesService } from './routes.service';
import { CreateRouteDto } from './dto/create-route.dto';
import { AssignRouteDto } from './dto/assign-route.dto';
import { AssignChildToRouteDto } from './dto/assign-child-to-route.dto';

@ApiTags('routes')
@ApiBearerAuth()
@Controller('routes')
export class RoutesController {
  constructor(private readonly routesService: RoutesService) {}

  @Post()
  @Roles(UserRole.SUPER_ADMIN, UserRole.TRANSPORT_OPERATOR, UserRole.SCHOOL_ADMIN)
  @Audited('ROUTE_CREATED')
  create(@Body() dto: CreateRouteDto, @CurrentUser() user: AuthenticatedUser) {
    return this.routesService.create(dto, user);
  }

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser, @Query() query: PaginationQueryDto) {
    return this.routesService.findAll(user, query);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.routesService.findOneScoped(id, user);
  }

  @Post(':id/assignments')
  @Roles(UserRole.SUPER_ADMIN, UserRole.TRANSPORT_OPERATOR, UserRole.SCHOOL_ADMIN)
  @Audited('ROUTE_ASSIGNMENT_CREATED')
  assign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignRouteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.routesService.assign(id, dto, user);
  }

  @Post(':id/children')
  @Roles(UserRole.SUPER_ADMIN, UserRole.TRANSPORT_OPERATOR, UserRole.SCHOOL_ADMIN)
  @Audited('CHILD_ROUTE_ASSIGNMENT_CREATED')
  assignChild(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignChildToRouteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.routesService.assignChild(id, dto, user);
  }

  @Delete(':id/children/:childId')
  @Roles(UserRole.SUPER_ADMIN, UserRole.TRANSPORT_OPERATOR, UserRole.SCHOOL_ADMIN)
  @Audited('CHILD_ROUTE_ASSIGNMENT_REMOVED')
  unassignChild(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('childId', ParseUUIDPipe) childId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.routesService.unassignChild(id, childId, user);
  }
}
