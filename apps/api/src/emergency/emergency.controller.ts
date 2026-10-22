import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { Audited } from '../common/decorators/audited.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import { EmergencyService } from './emergency.service';
import { TriggerSosDto } from './dto/trigger-sos.dto';
import { ResolveIncidentDto } from './dto/resolve-incident.dto';

@ApiTags('emergency')
@ApiBearerAuth()
@Controller('emergency')
export class EmergencyController {
  constructor(private readonly emergencyService: EmergencyService) {}

  @Post('sos')
  @Roles(UserRole.DRIVER, UserRole.SUPER_ADMIN, UserRole.TRANSPORT_OPERATOR)
  @Audited('SOS_TRIGGERED')
  trigger(@Body() dto: TriggerSosDto, @CurrentUser() user: AuthenticatedUser) {
    return this.emergencyService.triggerSos(dto, user);
  }

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser, @Query() query: PaginationQueryDto) {
    return this.emergencyService.findAll(user, query);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.emergencyService.findOneScoped(id, user);
  }

  @Post(':id/acknowledge')
  @Roles(UserRole.SUPER_ADMIN, UserRole.TRANSPORT_OPERATOR, UserRole.SCHOOL_ADMIN)
  @Audited('SOS_ACKNOWLEDGED')
  acknowledge(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.emergencyService.acknowledge(id, user);
  }

  @Post(':id/resolve')
  @Roles(UserRole.SUPER_ADMIN, UserRole.TRANSPORT_OPERATOR, UserRole.SCHOOL_ADMIN)
  @Audited('SOS_RESOLVED')
  resolve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveIncidentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.emergencyService.resolve(id, dto, user);
  }
}
