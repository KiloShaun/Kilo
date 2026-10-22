import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ChildIdMethod } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateChildDto {
  @ApiProperty()
  @IsString()
  @MaxLength(100)
  firstName: string;

  @ApiProperty()
  @IsString()
  @MaxLength(100)
  lastName: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @ApiProperty()
  @IsUUID()
  parentId: string;

  @ApiProperty()
  @IsUUID()
  schoolId: string;

  @ApiPropertyOptional({ enum: ChildIdMethod })
  @IsOptional()
  @IsEnum(ChildIdMethod)
  idMethod?: ChildIdMethod;

  @ApiPropertyOptional({ description: 'Opaque QR/NFC/RFID tag payload' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  idTagValue?: string;
}
