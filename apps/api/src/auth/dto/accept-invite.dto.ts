import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class AcceptInviteDto {
  @ApiProperty({ description: 'The one-time token from the invite link' })
  @IsString()
  token: string;

  @ApiProperty({ minLength: 10 })
  @IsString()
  @MinLength(10)
  @MaxLength(128)
  password: string;

  @ApiPropertyOptional({ description: 'Client-generated identifier for this device/session' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  deviceId?: string;
}
