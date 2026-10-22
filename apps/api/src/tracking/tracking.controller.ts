import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { TrackingService } from './tracking.service';
import { ReportLocationDto } from './dto/report-location.dto';

@ApiTags('tracking')
@ApiBearerAuth()
@Controller('tracking')
export class TrackingController {
  constructor(private readonly trackingService: TrackingService) {}

  @Post('locations')
  @Roles(UserRole.DRIVER)
  reportLocation(@Body() dto: ReportLocationDto, @CurrentUser() user: AuthenticatedUser) {
    return this.trackingService.reportLocation(dto, user);
  }

  @Get('journeys/:journeyId/location')
  getLatest(
    @Param('journeyId', ParseUUIDPipe) journeyId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.trackingService.getLatestForJourney(journeyId, user);
  }
}
