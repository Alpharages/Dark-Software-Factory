/**
 * QA Review Controller
 * Story 8.1: QA Review Queue & Sampling Configuration
 *
 * REST API endpoints for:
 * - Sampling configuration management
 * - QA Review Queue operations
 */

import {
  Controller,
  Get,
  Put,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  Patch,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { QaSamplingConfigService } from '../services/qa-sampling-config.service';
import { QaReviewQueueService } from '../services/qa-review-queue.service';
import { QaReviewMetricsService } from '../services/qa-review-metrics.service';
import { JwtAuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../auth/constants/roles.enum';
import { QueueStatus, QueueRiskLevel } from '../dto/qa-review-queue.dto';
import {
  UpdateSamplingConfigDto,
  SamplingConfigResponseDto,
  SamplingMetricsResponseDto,
} from '../dto/qa-sampling-config.dto';
import {
  QueueListQueryDto,
  QueuePageResponseDto,
  QueueItemDto,
  ReviewDecisionDto,
  QueueDetailsResponseDto,
  QueueDepthResponseDto,
} from '../dto/qa-review-queue.dto';
import { AiCodeReviewService } from '../services/ai-code-review.service'; // Story 8.2
import { AiCodeReviewResponseDto } from '../dto/ai-code-review.dto';
import { UpdateFindingStatusDto } from '../dto/update-finding-status.dto';

/**
 * Sampling Configuration Controller
 * Handles configuration for QA sampling strategies
 */
@ApiTags('QA Sampling Configuration')
@Controller('qa-review/config')
@UseGuards(JwtAuthGuard, RolesGuard, ThrottlerGuard)
@ApiBearerAuth()
export class QaSamplingConfigController {
  constructor(private readonly configService: QaSamplingConfigService) {}

  @Get()
  @Roles(Role.QA, Role.PM, Role.TL, Role.MANAGER, Role.ADMIN)
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  @ApiOperation({ summary: 'Get current sampling configuration' })
  @ApiResponse({
    status: 200,
    description: 'Current sampling configuration',
    type: SamplingConfigResponseDto,
  })
  async getConfig(): Promise<SamplingConfigResponseDto> {
    const config = await this.configService.getConfig();
    return {
      ...config,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  @Put()
  @Roles(Role.QA, Role.ADMIN)
  @Throttle({ default: { limit: 50, ttl: 60000 } })
  @ApiOperation({ summary: 'Update sampling configuration' })
  @ApiResponse({
    status: 200,
    description: 'Updated sampling configuration',
    type: SamplingConfigResponseDto,
  })
  async updateConfig(@Body() dto: UpdateSamplingConfigDto): Promise<SamplingConfigResponseDto> {
    const config = await this.configService.updateConfig({
      percentage: dto.percentage,
      riskBasedEnabled: dto.riskBasedEnabled,
      riskRules: dto.riskRules as {
        fileCount: {
          highThreshold: number;
          mediumThreshold: number;
          highMultiplier: number;
          mediumMultiplier: number;
        };
        complexity: {
          highThreshold: number;
          mediumThreshold: number;
          highMultiplier: number;
          mediumMultiplier: number;
        };
        aiProvider: { cursorMultiplier: number; claudeMultiplier: number };
      },
      randomSeed: dto.randomSeed,
    });
    return {
      ...config,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  @Get('history')
  @Roles(Role.QA, Role.ADMIN)
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  @ApiOperation({ summary: 'Get configuration history' })
  @ApiResponse({
    status: 200,
    description: 'Configuration history',
    type: [SamplingConfigResponseDto],
  })
  async getConfigHistory(): Promise<SamplingConfigResponseDto[]> {
    const configs = await this.configService.getConfigHistory(10);
    return configs.map((c) => ({
      ...c,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
  }
}

/**
 * QA Review Queue Controller
 * Handles queue management operations
 */
@ApiTags('QA Review Queue')
@Controller('qa-review/queue')
@UseGuards(JwtAuthGuard, RolesGuard, ThrottlerGuard)
@ApiBearerAuth()
export class QaReviewQueueController {
  constructor(
    private readonly queueService: QaReviewQueueService,
    private readonly metricsService: QaReviewMetricsService,
    private readonly aiReviewService: AiCodeReviewService, // Story 8.2
  ) {}

  @Get()
  @Roles(Role.QA, Role.PM, Role.TL, Role.MANAGER, Role.ADMIN)
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  @ApiOperation({ summary: 'Get QA Review Queue with filters' })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of queue items',
    type: QueuePageResponseDto,
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['PENDING', 'IN_REVIEW', 'APPROVED', 'REJECTED'],
  })
  @ApiQuery({ name: 'riskLevel', required: false, enum: ['LOW', 'MEDIUM', 'HIGH'] })
  @ApiQuery({ name: 'projectId', required: false, type: String })
  @ApiQuery({ name: 'aiProvider', required: false, enum: ['cursor', 'claude'] })
  @ApiQuery({ name: 'sortBy', required: false, enum: ['risk_level', 'created_at'] })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'] })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getQueue(@Query() query: QueueListQueryDto): Promise<QueuePageResponseDto> {
    const result = await this.queueService.queryQueue({
      status: query.status,
      riskLevel: query.riskLevel,
      projectId: query.projectId,
      aiProvider: query.aiProvider,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
      page: query.page,
      limit: query.limit,
    });

    return {
      items: result.items.map((item) => this.mapToQueueItemDto(item)),
      total: result.total,
      page: result.page,
      totalPages: result.totalPages,
      hasNextPage: result.hasNextPage,
      hasPreviousPage: result.hasPreviousPage,
    };
  }

  @Get('depth')
  @Roles(Role.QA, Role.PM, Role.TL, Role.MANAGER, Role.ADMIN)
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  @ApiOperation({ summary: 'Get queue depth by status' })
  @ApiResponse({
    status: 200,
    description: 'Queue depth by status',
    type: QueueDepthResponseDto,
  })
  async getQueueDepth(): Promise<QueueDepthResponseDto> {
    const depths = await this.queueService.getQueueDepth();
    return { depths };
  }

  @Get('metrics')
  @Roles(Role.QA, Role.ADMIN)
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  @ApiOperation({ summary: 'Get sampling metrics' })
  @ApiResponse({
    status: 200,
    description: 'Sampling metrics',
    type: SamplingMetricsResponseDto,
  })
  async getMetrics(): Promise<SamplingMetricsResponseDto> {
    const metrics = await this.metricsService.getAggregatedMetrics();
    return {
      totalTicketsProcessed: metrics.totalTicketsProcessed,
      totalTicketsSampled: metrics.totalTicketsSampled,
      actualSampleRate: metrics.actualSampleRate,
      configuredSampleRate: metrics.configuredSampleRate,
      riskDistribution: metrics.riskDistribution,
      strategyDistribution: metrics.strategyDistribution,
      averageTimeInQueue: metrics.averageTimeInQueue,
    };
  }

  @Get(':id')
  @Roles(Role.QA, Role.PM, Role.TL, Role.MANAGER, Role.ADMIN)
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  @ApiOperation({ summary: 'Get queue entry by ID' })
  @ApiResponse({
    status: 200,
    description: 'Queue entry details',
    type: QueueItemDto,
  })
  async getQueueEntry(@Param('id') id: string): Promise<QueueItemDto> {
    const item = await this.queueService.getById(id);
    return this.mapToQueueItemDto(item);
  }

  @Get(':id/details')
  @Roles(Role.QA, Role.PM, Role.TL, Role.MANAGER, Role.ADMIN)
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  @ApiOperation({ summary: 'Get detailed QA results for queue entry' })
  @ApiResponse({
    status: 200,
    description: 'Queue entry with QA details',
    type: QueueDetailsResponseDto,
  })
  async getQueueDetails(@Param('id') id: string): Promise<QueueDetailsResponseDto> {
    const details = await this.queueService.getQueueDetails(id);
    return {
      queueEntry: this.mapToQueueItemDto(details.queueEntry),
      execution: details.execution
        ? {
            id: details.execution.id,
            ticketId: details.execution.ticketId,
            aiProvider: details.execution.aiProvider,
            status: details.execution.status,
            complexityScore: details.execution.complexityScore,
            filesChanged: details.execution.filesChanged,
          }
        : undefined,
      qaResult: details.qaResult ? (details.qaResult as Record<string, unknown>) : undefined,
    };
  }

  @Post(':id/claim')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.QA, Role.ADMIN)
  @Throttle({ default: { limit: 50, ttl: 60000 } })
  @ApiOperation({ summary: 'Claim a ticket for review' })
  @ApiResponse({
    status: 200,
    description: 'Ticket claimed successfully',
    type: QueueItemDto,
  })
  async claimTicket(
    @Param('id') id: string,
    @Body() dto: ReviewDecisionDto,
  ): Promise<QueueItemDto> {
    const item = await this.queueService.claimTicket(id, dto.reviewerId);
    return this.mapToQueueItemDto(item);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.QA, Role.ADMIN)
  @Throttle({ default: { limit: 50, ttl: 60000 } })
  @ApiOperation({ summary: 'Approve a ticket' })
  @ApiResponse({
    status: 200,
    description: 'Ticket approved successfully',
    type: QueueItemDto,
  })
  async approveTicket(
    @Param('id') id: string,
    @Body() dto: ReviewDecisionDto,
  ): Promise<QueueItemDto> {
    const item = await this.queueService.approveTicket(id, dto.reviewerId, dto.notes);
    return this.mapToQueueItemDto(item);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.QA, Role.ADMIN)
  @Throttle({ default: { limit: 50, ttl: 60000 } })
  @ApiOperation({ summary: 'Reject a ticket' })
  @ApiResponse({
    status: 200,
    description: 'Ticket rejected successfully',
    type: QueueItemDto,
  })
  async rejectTicket(
    @Param('id') id: string,
    @Body() dto: ReviewDecisionDto,
  ): Promise<QueueItemDto> {
    const item = await this.queueService.rejectTicket(id, dto.reviewerId, dto.notes);
    return this.mapToQueueItemDto(item);
  }

  @Post(':id/unclaim')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.QA, Role.ADMIN)
  @Throttle({ default: { limit: 50, ttl: 60000 } })
  @ApiOperation({ summary: 'Unclaim a ticket (return to pending)' })
  @ApiResponse({
    status: 200,
    description: 'Ticket unclaimed successfully',
    type: QueueItemDto,
  })
  async unclaimTicket(
    @Param('id') id: string,
    @Body() dto: ReviewDecisionDto,
  ): Promise<QueueItemDto> {
    const item = await this.queueService.unclaimTicket(id, dto.reviewerId);
    return this.mapToQueueItemDto(item);
  }

  @Get(':id/ai-review')
  @Roles(Role.QA, Role.PM, Role.TL, Role.MANAGER, Role.ADMIN)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({ summary: 'Get AI Code Review' })
  @ApiResponse({
    status: 200,
    description: 'AI Code Review results',
    type: AiCodeReviewResponseDto,
  })
  async getAiReview(@Param('id') id: string): Promise<AiCodeReviewResponseDto> {
    return this.aiReviewService.generateReview(id, false); // false = not forced, use cache
  }

  @Post(':id/regenerate')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.QA, Role.ADMIN)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Force regenerate AI Code Review' })
  @ApiResponse({
    status: 200,
    description: 'Regenerated AI Code Review',
    type: AiCodeReviewResponseDto,
  })
  async regenerateReview(@Param('id') id: string): Promise<AiCodeReviewResponseDto> {
    return this.aiReviewService.generateReview(id, true); // true = forced
  }

  @Patch(':id/findings/:findingId')
  @Roles(Role.QA, Role.ADMIN)
  @Throttle({ default: { limit: 50, ttl: 60000 } })
  @ApiOperation({ summary: 'Update finding status' })
  @ApiResponse({
    status: 200,
    description: 'Finding status updated',
  })
  async updateFindingStatus(
    @Param('id') id: string,
    @Param('findingId') findingId: string,
    @Body() dto: UpdateFindingStatusDto,
    @Req() req: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  ): Promise<void> {
    await this.aiReviewService.updateFindingStatus(findingId, dto, req.user?.id || 'system');
  }

  /**
   * Map queue item interface to DTO
   */
  private mapToQueueItemDto(item: {
    id: string;
    ticketId: string;
    ticketTitle?: string;
    executionId: string;
    prUrl?: string;
    prId?: string;
    status: string;
    riskLevel: string;
    riskFactors: string[];
    aiProvider: string;
    complexityScore: number;
    filesChanged: number;
    samplingStrategy: string;
    createdAt: Date;
    reviewedBy?: string;
    reviewedAt?: Date;
    reviewNotes?: string;
  }): QueueItemDto {
    return {
      id: item.id,
      ticketId: item.ticketId,
      ticketTitle: item.ticketTitle,
      executionId: item.executionId,
      prUrl: item.prUrl,
      prId: item.prId,
      status: item.status as QueueStatus,
      riskLevel: item.riskLevel as QueueRiskLevel,
      riskFactors: item.riskFactors,
      aiProvider: item.aiProvider,
      complexityScore: item.complexityScore,
      filesChanged: item.filesChanged,
      samplingStrategy: item.samplingStrategy,
      createdAt: item.createdAt,
      reviewedBy: item.reviewedBy,
      reviewedAt: item.reviewedAt,
      reviewNotes: item.reviewNotes,
    };
  }
}
