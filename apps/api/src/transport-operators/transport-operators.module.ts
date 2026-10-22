import { Module } from '@nestjs/common';
import { TransportOperatorsController } from './transport-operators.controller';
import { TransportOperatorsService } from './transport-operators.service';

@Module({
  controllers: [TransportOperatorsController],
  providers: [TransportOperatorsService],
})
export class TransportOperatorsModule {}
