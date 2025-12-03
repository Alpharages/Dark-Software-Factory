import { Controller, Post, Body, HttpCode, HttpStatus, UseGuards, Logger } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { JwtAuthGuard, RolesGuard } from '../common/guards';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Roles } from '../common/decorators/roles.decorator';
import { CorrelationId } from '../common/decorators/correlation-id.decorator';
import { Role } from '../auth/constants/roles.enum';
import { TicketQualityService } from './ticket-quality.service';
import {
  QualityScoreRequestDto,
  QualityScoreResponseDto,
  QuickScoreResponseDto,
  BatchQualityScoreRequestDto,
  BatchQualityScoreResponseDto,
} from './dto';

/**
 * Ticket Quality Controller
 *
 * Story 2.11: PM-Facing Quality Scoring API
 * FR4: PMs can view ticket quality score before submitting
 *
 * Authorization: JWT + PM/ADMIN role required
 * Rate Limits: Per-endpoint customization
 */
@ApiTags('Ticket Quality')
@Controller('api/v1/ticket-quality')
@UseGuards(JwtAuthGuard, RolesGuard, ThrottlerGuard)
@ApiBearerAuth()
export class TicketQualityController {
  private readonly logger = new Logger(TicketQualityController.name);

  constructor(private readonly qualityService: TicketQualityService) {}

  /**
   * Check ticket quality score
   *
   * Returns comprehensive quality analysis with breakdown,
   * suggestions, and grade for PM review before submission.
   *
   * @param request - Ticket data to score
   * @param correlationId - Auto-generated correlation ID
   * @returns Full quality score with breakdown
   */
  @Post('score')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.PM, Role.ADMIN, Role.MANAGER)
  @Throttle({ default: { limit: 30, ttl: 60000 } }) // 30 req/min
  @ApiOperation({
    summary: 'Check ticket quality score (PM/Admin only)',
    description:
      'Calculates comprehensive quality score with detailed breakdown and improvement suggestions. Use before submitting tickets to ensure quality.',
  })
  @ApiBody({ type: QualityScoreRequestDto })
  @ApiResponse({
    status: 200,
    description: 'Quality score calculated successfully',
    type: QualityScoreResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid request data' })
  @ApiResponse({ status: 401, description: 'Unauthorized - JWT required' })
  @ApiResponse({ status: 403, description: 'Forbidden - PM/Admin role required' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded (30/min)' })
  async checkQuality(
    @Body() request: QualityScoreRequestDto,
    @CorrelationId() correlationId: string,
  ): Promise<QualityScoreResponseDto> {
    this.logger.log(`[${correlationId}] Quality score request for: ${request.title}`);

    const result = await this.qualityService.calculateScoreEnhanced(request, correlationId);

    this.logger.log(`[${correlationId}] Quality score: ${result.totalScore}/100 (${result.grade})`);

    return result;
  }

  /**
   * Quick quality check
   *
   * Returns lightweight score and grade only.
   * Use for quick validation without full breakdown.
   *
   * @param request - Ticket data to score
   * @param correlationId - Auto-generated correlation ID
   * @returns Score and grade only
   */
  @Post('quick-check')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.PM, Role.ADMIN, Role.MANAGER)
  @Throttle({ default: { limit: 60, ttl: 60000 } }) // 60 req/min (lightweight)
  @ApiOperation({
    summary: 'Quick quality check - score and grade only',
    description:
      'Returns only score and grade without detailed breakdown. Faster and lighter for bulk checking.',
  })
  @ApiBody({ type: QualityScoreRequestDto })
  @ApiResponse({
    status: 200,
    description: 'Quick score returned',
    type: QuickScoreResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid request data' })
  @ApiResponse({ status: 401, description: 'Unauthorized - JWT required' })
  @ApiResponse({ status: 403, description: 'Forbidden - PM/Admin role required' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded (60/min)' })
  async quickCheck(
    @Body() request: QualityScoreRequestDto,
    @CorrelationId() correlationId: string,
  ): Promise<QuickScoreResponseDto> {
    this.logger.debug(`[${correlationId}] Quick check for: ${request.title}`);

    return this.qualityService.quickScore(request, correlationId);
  }

  /**
   * Batch quality scoring
   *
   * Score multiple tickets in one request.
   * Limited to 10 tickets per batch.
   *
   * @param request - Array of tickets to score
   * @param correlationId - Auto-generated correlation ID
   * @returns Array of scores with aggregate statistics
   */
  @Post('batch-score')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.PM, Role.ADMIN, Role.MANAGER)
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // 10 req/min (heavy operation)
  @ApiOperation({
    summary: 'Batch quality scoring for multiple tickets',
    description:
      'Score up to 10 tickets in one request. Returns individual scores plus aggregate statistics.',
  })
  @ApiBody({ type: BatchQualityScoreRequestDto })
  @ApiResponse({
    status: 200,
    description: 'Batch scores calculated',
    type: BatchQualityScoreResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid request data or too many tickets' })
  @ApiResponse({ status: 401, description: 'Unauthorized - JWT required' })
  @ApiResponse({ status: 403, description: 'Forbidden - PM/Admin role required' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded (10/min)' })
  async batchScore(
    @Body() request: BatchQualityScoreRequestDto,
    @CorrelationId() correlationId: string,
  ): Promise<BatchQualityScoreResponseDto> {
    this.logger.log(`[${correlationId}] Batch score for ${request.tickets.length} tickets`);

    const results = await this.qualityService.batchScoreEnhanced(request.tickets, correlationId);
    const averageScore =
      results.length > 0
        ? Math.round(results.reduce((sum, r) => sum + r.totalScore, 0) / results.length)
        : 0;

    this.logger.log(
      `[${correlationId}] Batch complete: ${results.length} tickets, avg ${averageScore}/100`,
    );

    const response: BatchQualityScoreResponseDto = {
      results,
      processedCount: results.length,
      averageScore,
    };

    return response;
  }
}
