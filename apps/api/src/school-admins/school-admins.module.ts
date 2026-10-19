import { Module } from '@nestjs/common';
import { SchoolAdminsController } from './school-admins.controller';
import { SchoolAdminsService } from './school-admins.service';

@Module({
  controllers: [SchoolAdminsController],
  providers: [SchoolAdminsService],
})
export class SchoolAdminsModule {}
