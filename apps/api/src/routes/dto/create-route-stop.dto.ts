import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export class CreateRouteStopDto {
  @IsInt()
  @Min(1)
  sequence: number;

  @IsString()
  name: string;

  @IsLatitude()
  latitude: number;

  @IsLongitude()
  longitude: number;

  @ApiPropertyOptional({ description: '"HH:mm", local to the route', example: '06:45' })
  @IsOptional()
  @Matches(HHMM)
  scheduledPickupTime?: string;

  @ApiPropertyOptional({ description: '"HH:mm", local to the route', example: '14:15' })
  @IsOptional()
  @Matches(HHMM)
  scheduledDropoffTime?: string;
}
