import { ApiPropertyOptional } from '@nestjs/swagger';
import { VerificationMethod } from '@prisma/client';
import { IsEnum, IsLatitude, IsLongitude, IsOptional } from 'class-validator';

export class VerifyChildDto {
  @IsEnum(VerificationMethod)
  verificationMethod: VerificationMethod;

  @ApiPropertyOptional()
  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsLongitude()
  longitude?: number;
}
