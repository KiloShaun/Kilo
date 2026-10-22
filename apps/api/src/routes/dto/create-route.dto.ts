import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';
import { CreateRouteStopDto } from './create-route-stop.dto';

export class CreateRouteDto {
  @IsString()
  name: string;

  @IsUUID()
  schoolId: string;

  @ApiPropertyOptional({ type: [CreateRouteStopDto] })
  @IsOptional()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateRouteStopDto)
  stops?: CreateRouteStopDto[];
}
