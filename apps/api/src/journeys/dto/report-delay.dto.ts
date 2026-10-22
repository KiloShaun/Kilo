import { IsString, MinLength } from 'class-validator';

export class ReportDelayDto {
  @IsString()
  @MinLength(3)
  reason: string;
}
