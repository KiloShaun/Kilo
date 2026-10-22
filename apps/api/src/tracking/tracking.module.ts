import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JourneysModule } from '../journeys/journeys.module';
import { TrackingController } from './tracking.controller';
import { TrackingService } from './tracking.service';
import { TrackingGateway } from './tracking.gateway';

@Module({
  imports: [JwtModule.register({}), JourneysModule],
  controllers: [TrackingController],
  providers: [TrackingService, TrackingGateway],
  exports: [TrackingService],
})
export class TrackingModule {}
