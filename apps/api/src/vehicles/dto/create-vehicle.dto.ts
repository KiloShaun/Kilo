import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VehicleType } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class CreateVehicleDto {
  @ApiProperty()
  @IsString()
  @MaxLength(20)
  registrationNumber: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  make?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  model?: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  @Max(100)
  capacity: number;

  @ApiProperty({ enum: VehicleType })
  @IsEnum(VehicleType)
  vehicleType: VehicleType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  currentDriverId?: string;
}
