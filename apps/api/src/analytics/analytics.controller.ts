import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiProduces, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { AnalyticsService } from './analytics.service';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';

/**
 * Phase 11 — read-only operational reporting. Every figure is derived from the journey,
 * child-journey, event and incident records the rest of the platform already writes; there
 * is no separate analytics store to drift out of sync.
 */
@ApiTags('analytics')
@ApiBearerAuth()
@Controller('analytics')
@Roles(UserRole.SUPER_ADMIN, UserRole.TRANSPORT_OPERATOR, UserRole.SCHOOL_ADMIN)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('summary')
  summary(@Query() query: AnalyticsQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.analyticsService.summary(query, user);
  }

  @Get('journeys.csv')
  @ApiProduces('text/csv')
  async journeysCsv(
    @Query() query: AnalyticsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { filename, body } = await this.analyticsService.journeysCsv(query, user);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return body;
  }
}
