import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { Audited } from '../common/decorators/audited.decorator';
import { DriversService } from './drivers.service';
import { CreateDriverDto } from './dto/create-driver.dto';

@ApiTags('drivers')
@ApiBearerAuth()
@Controller('drivers')
export class DriversController {
  constructor(private readonly driversService: DriversService) {}

  @Post()
  @Roles(UserRole.SUPER_ADMIN, UserRole.TRANSPORT_OPERATOR)
  @Audited('DRIVER_CREATED')
  create(@Body() dto: CreateDriverDto) {
    return this.driversService.create(dto);
  }
}
