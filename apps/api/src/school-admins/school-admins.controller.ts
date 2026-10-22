import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { Audited } from '../common/decorators/audited.decorator';
import { SchoolAdminsService } from './school-admins.service';
import { CreateSchoolAdminDto } from './dto/create-school-admin.dto';

@ApiTags('school-admins')
@ApiBearerAuth()
@Controller('school-admins')
export class SchoolAdminsController {
  constructor(private readonly schoolAdminsService: SchoolAdminsService) {}

  @Post()
  @Roles(UserRole.SUPER_ADMIN, UserRole.TRANSPORT_OPERATOR)
  @Audited('SCHOOL_ADMIN_CREATED')
  create(@Body() dto: CreateSchoolAdminDto) {
    return this.schoolAdminsService.create(dto);
  }
}
