import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { Audited } from '../common/decorators/audited.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import { JourneysService } from './journeys.service';
import { CreateJourneyDto } from './dto/create-journey.dto';
import { VerifyChildDto } from './dto/verify-child.dto';
import { ReportDelayDto } from './dto/report-delay.dto';

@ApiTags('journeys')
@ApiBearerAuth()
@Controller('journeys')
export class JourneysController {
  constructor(private readonly journeysService: JourneysService) {}

  @Post()
  @Roles(UserRole.SUPER_ADMIN, UserRole.TRANSPORT_OPERATOR, UserRole.SCHOOL_ADMIN)
  @Audited('JOURNEY_CREATED')
  create(@Body() dto: CreateJourneyDto, @CurrentUser() user: AuthenticatedUser) {
    return this.journeysService.create(dto, user);
  }

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser, @Query() query: PaginationQueryDto) {
    return this.journeysService.findAll(user, query);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.journeysService.findOneScoped(id, user);
  }

  @Post(':id/start')
  @Roles(UserRole.DRIVER)
  @Audited('JOURNEY_STARTED')
  start(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.journeysService.start(id, user);
  }

  @Post(':id/end')
  @Roles(UserRole.DRIVER)
  @Audited('JOURNEY_ENDED')
  end(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.journeysService.end(id, user);
  }

  @Post(':id/cancel')
  @Roles(UserRole.DRIVER)
  @Audited('JOURNEY_CANCELLED')
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.journeysService.cancel(id, user);
  }

  @Post(':id/delay')
  @Roles(UserRole.DRIVER)
  @Audited('JOURNEY_DELAY_REPORTED')
  reportDelay(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReportDelayDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.journeysService.reportDelay(id, dto, user);
  }

  @Post(':id/children/:childId/pickup')
  @Roles(UserRole.DRIVER)
  @Audited('CHILD_PICKED_UP')
  pickupChild(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('childId', ParseUUIDPipe) childId: string,
    @Body() dto: VerifyChildDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.journeysService.pickupChild(id, childId, dto, user);
  }

  @Post(':id/children/:childId/dropoff')
  @Roles(UserRole.DRIVER)
  @Audited('CHILD_DROPPED_OFF')
  dropoffChild(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('childId', ParseUUIDPipe) childId: string,
    @Body() dto: VerifyChildDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.journeysService.dropoffChild(id, childId, dto, user);
  }

  @Post(':id/children/:childId/missed-pickup')
  @Roles(UserRole.DRIVER)
  @Audited('CHILD_MISSED_PICKUP')
  missedPickup(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('childId', ParseUUIDPipe) childId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.journeysService.missedPickup(id, childId, user);
  }
}
