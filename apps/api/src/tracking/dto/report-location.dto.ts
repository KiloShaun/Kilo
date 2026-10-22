import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsLatitude, IsLongitude, IsOptional, IsUUID, Min } from 'class-validator';

export class ReportLocationDto {
  @IsUUID()
  journeyId: string;

  @IsLatitude()
  latitude: number;

  @IsLongitude()
  longitude: number;

  // 0 is a legitimate (if unusually precise) accuracy reading, and a stationary vehicle
  // legitimately reports 0 km/h — neither should be rejected as "not positive".
  @ApiPropertyOptional()
  @IsOptional()
  @Min(0)
  accuracyMeters?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Min(0)
  speedKph?: number;

  @ApiPropertyOptional({ description: 'Defaults to now if omitted' })
  @IsOptional()
  @IsDateString()
  recordedAt?: string;
}
