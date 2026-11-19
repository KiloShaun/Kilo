import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsUUID, Matches } from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class AnalyticsQueryDto {
  @ApiPropertyOptional({
    description: 'Inclusive start date (YYYY-MM-DD). Defaults to 29 days before `to`.',
    example: '2026-11-01',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(DATE_ONLY, { message: 'from must be a date in YYYY-MM-DD form' })
  from?: string;

  @ApiPropertyOptional({
    description: 'Inclusive end date (YYYY-MM-DD). Defaults to today (UTC).',
    example: '2026-11-30',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(DATE_ONLY, { message: 'to must be a date in YYYY-MM-DD form' })
  to?: string;

  @ApiPropertyOptional({
    description:
      'Restrict to one school. Ignored for SCHOOL_ADMIN, who is always scoped to their own school.',
  })
  @IsOptional()
  @IsUUID()
  schoolId?: string;
}
