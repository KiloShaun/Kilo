import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsPositive,
  IsUUID,
} from 'class-validator';

export class ReportLocationDto {
  @IsUUID()
  journeyId: string;

  @IsLatitude()
  latitude: number;

  @IsLongitude()
  longitude: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsPositive()
  accuracyMeters?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsPositive()
  speedKph?: number;

  @ApiPropertyOptional({ description: 'Defaults to now if omitted' })
  @IsOptional()
  @IsDateString()
  recordedAt?: string;
}
