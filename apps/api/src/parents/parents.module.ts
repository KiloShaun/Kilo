import { Module } from '@nestjs/common';
import { ParentsController } from './parents.controller';
import { ChildrenModule } from '../children/children.module';

@Module({
  imports: [ChildrenModule],
  controllers: [ParentsController],
})
export class ParentsModule {}
