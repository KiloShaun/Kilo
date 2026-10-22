import { JourneyDirection } from '@prisma/client';
import { IsDateString, IsEnum, IsUUID } from 'class-validator';

export class CreateJourneyDto {
  @IsUUID()
  routeId: string;

  @IsEnum(JourneyDirection)
  direction: JourneyDirection;

  @IsDateString()
  scheduledDate: string;
}
