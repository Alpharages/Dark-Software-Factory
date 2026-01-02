import { Controller, Get, Post, Body, Param, Query, UseGuards, Logger } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiBody,
  ApiQuery,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '@/common/guards/auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Roles } from '@/common/decorators/roles.decorator';
import { Role } from '@/auth/constants/roles.enum';
import { AdrService } from './adr.service';
import {
  AdrReviewQueueQueryDto,
  AdrReviewQueueResponseDto,
  AdrReviewActionDto,
  AdrReviewResponseDto,
  ProvideGuidanceDto,
  DelegateAdrDto,
} from './dto';
import { MetricsService } from '@/common/metrics/metrics.service';
import { Prisma } from '@/prisma/client';

@ApiTags('architecture-review')
@ApiBearerAuth()
@Controller('api/v1/architecture-review')
@UseGuards(JwtAuthGuard, RolesGuard, ThrottlerGuard)
export class ArchitectureReviewController {
  private readonly logger = new Logger(ArchitectureReviewController.name);

  constructor(
    private readonly adrService: AdrService,
    private readonly metricsService: MetricsService,
  ) {}

  @Get('queue')
  @Roles(Role.TL, Role.ADMIN)
  @ApiOperation({ summary: 'Get ADR review queue for TL' })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['PROPOSED', 'APPROVED', 'REJECTED', 'MODIFIED', 'DEFERRED'],
    description: 'Filter by ADR status (default: PROPOSED)',
  })
  @ApiQuery({
    name: 'risk_level',
    required: false,
    enum: ['LOW', 'MEDIUM', 'HIGH'],
    description: 'Filter by risk level',
  })
  @ApiQuery({
    name: 'project_id',
    required: false,
    type: String,
    description: 'Filter by project UUID',
  })
  @ApiQuery({
    name: 'min_confidence',
    required: false,
    type: Number,
    description: 'Minimum AI confidence (0.0-1.0)',
  })
  @ApiQuery({
    name: 'max_confidence',
    required: false,
    type: Number,
    description: 'Maximum AI confidence (0.0-1.0)',
  })
  @ApiQuery({
    name: 'sort_by',
    required: false,
    enum: ['risk_level', 'created_at', 'confidence'],
    description: 'Sort field (default: risk_level)',
  })
  @ApiQuery({
    name: 'sort_order',
    required: false,
    enum: ['ASC', 'DESC'],
    description: 'Sort order (default: DESC)',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns ADR review queue with ticket context and estimated review time',
    schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              title: { type: 'string' },
              status: {
                type: 'string',
                enum: ['PROPOSED', 'APPROVED', 'REJECTED', 'MODIFIED', 'DEFERRED'],
              },
              risk_level: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'], nullable: true },
              ai_confidence: { type: 'number', format: 'float' },
              created_at: { type: 'string', format: 'date-time' },
              estimated_review_time_minutes: { type: 'integer' },
              ticket: {
                type: 'object',
                nullable: true,
                properties: {
                  id: { type: 'string', format: 'uuid' },
                  title: { type: 'string' },
                  clickup_task_id: { type: 'string', nullable: true },
                },
              },
              execution_id: { type: 'string', format: 'uuid', nullable: true },
            },
          },
        },
        total: { type: 'integer' },
      },
    },
  })
  async getQueue(@Query() query: AdrReviewQueueQueryDto): Promise<AdrReviewQueueResponseDto> {
    this.logger.log(`TL accessing ADR review queue with filters: ${JSON.stringify(query)}`);

    // Record Prometheus metrics for queue access
    const hasFilters = Object.keys(query).length > 2; // More than just status and sort_by defaults
    this.metricsService.incrementCounter('adr_queue_accessed_total', {
      role: Role.TL,
      has_filters: hasFilters.toString(),
    });

    const items = await this.adrService.getReviewQueue(query);

    // Record queue depth gauge (current count of PROPOSED ADRs)
    this.metricsService.setGauge('adr_queue_depth', items.length);

    return {
      items,
      total: items.length,
    };
  }

  @Post(':id/review')
  @Roles(Role.TL, Role.ADMIN)
  @ApiOperation({ summary: 'Review and approve/reject/modify/defer an ADR' })
  @ApiParam({
    name: 'id',
    description: 'ADR UUID',
    type: String,
    example: 'adr-123',
  })
  @ApiBody({
    type: AdrReviewActionDto,
    description: 'Review action and optional notes',
    examples: {
      approve: {
        summary: 'Approve ADR',
        value: { action: 'APPROVE' },
      },
      reject: {
        summary: 'Reject ADR with reason',
        value: {
          action: 'REJECT',
          notes: 'Security concerns with this approach - please use PostgreSQL instead',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'ADR review action completed successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: 'ADR approved successfully' },
        adr: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            title: { type: 'string' },
            status: {
              type: 'string',
              enum: ['PROPOSED', 'ACCEPTED', 'REJECTED', 'DEPRECATED', 'SUPERSEDED'],
            },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'ADR not found' })
  @ApiResponse({ status: 400, description: 'ADR already reviewed or validation error' })
  async reviewAdr(
    @Param('id') adrId: string,
    @Body() reviewDto: AdrReviewActionDto,
  ): Promise<AdrReviewResponseDto> {
    this.logger.log(`TL reviewing ADR ${adrId} with action: ${reviewDto.action}`);

    // Record Prometheus metrics for review action
    this.metricsService.incrementCounter('adr_review_action_total', {
      action: reviewDto.action,
      role: Role.TL,
    });

    return this.adrService.reviewAdr(adrId, reviewDto.action, reviewDto.notes);
  }

  @Post(':id/guidance')
  @Roles(Role.TL, Role.ADMIN)
  @ApiOperation({ summary: 'Provide guidance for an escalated ADR (Story 7.6 AC#3)' })
  @ApiParam({
    name: 'id',
    description: 'Escalated ADR UUID',
    type: String,
    example: 'adr-escalated-123',
  })
  @ApiBody({
    description: 'TL guidance for resolving escalated decision',
    schema: {
      type: 'object',
      required: ['guidance'],
      properties: {
        guidance: {
          type: 'string',
          minLength: 10,
          example:
            'Use JWT with Redis refresh tokens for better scalability. Token revocation complexity is acceptable for our use case.',
          description: 'TL guidance text (minimum 10 characters)',
        },
        apply_globally: {
          type: 'boolean',
          default: false,
          description: 'Whether to update architecture constraints globally',
        },
        update_thresholds: {
          type: 'boolean',
          default: false,
          description: 'Whether to adjust confidence threshold',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Guidance provided successfully, ADR updated to GUIDANCE_PROVIDED status',
  })
  @ApiResponse({ status: 404, description: 'ADR not found' })
  @ApiResponse({ status: 400, description: 'ADR is not in ESCALATED status' })
  async provideGuidance(
    @Param('id') adrId: string,
    @Body() guidanceDto: ProvideGuidanceDto,
  ): Promise<{
    success: boolean;
    message: string;
    adr: { id: string; status: string };
    escalation_duration_seconds?: number;
  }> {
    this.logger.log(`TL providing guidance for escalated ADR ${adrId}`);

    // Record Prometheus metrics
    this.metricsService.incrementCounter('adr_guidance_provided_total', {
      role: Role.TL,
    });

    const result = await this.adrService.provideGuidance(adrId, guidanceDto);

    // Record resolution time if available
    if (result.escalation_duration_seconds) {
      this.metricsService.recordHistogram(
        'adr_escalation_resolution_duration_seconds',
        result.escalation_duration_seconds,
        { outcome: 'guidance_provided' },
      );
    }

    return {
      success: true,
      message: 'Guidance provided successfully',
      adr: { id: result.id, status: result.status },
      escalation_duration_seconds: result.escalation_duration_seconds || undefined,
    };
  }

  @Post(':id/delegate')
  @Roles(Role.TL, Role.ADMIN)
  @ApiOperation({ summary: 'Delegate an escalated ADR to architect (Story 7.6 AC#3)' })
  @ApiParam({
    name: 'id',
    description: 'Escalated ADR UUID',
    type: String,
    example: 'adr-escalated-456',
  })
  @ApiBody({
    description: 'Delegation information',
    schema: {
      type: 'object',
      required: ['delegate_to_user_id'],
      properties: {
        delegate_to_user_id: {
          type: 'string',
          format: 'uuid',
          example: '550e8400-e29b-41d4-a716-446655440000',
          description: 'User ID to delegate to (architect or senior developer)',
        },
        notes: {
          type: 'string',
          minLength: 10,
          example:
            'This decision requires deep knowledge of the authentication system architecture.',
          description: 'Optional delegation notes (minimum 10 characters if provided)',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'ADR delegated successfully',
  })
  @ApiResponse({ status: 404, description: 'ADR not found' })
  @ApiResponse({ status: 400, description: 'ADR is not in ESCALATED status' })
  async delegateAdr(
    @Param('id') adrId: string,
    @Body() delegateDto: DelegateAdrDto,
  ): Promise<{ success: boolean; message: string; adr: { id: string; status: string } }> {
    this.logger.log(`TL delegating ADR ${adrId} to ${delegateDto.delegate_to_user_id}`);

    // Record Prometheus metrics
    this.metricsService.incrementCounter('adr_delegated_total', {
      role: Role.TL,
    });

    const result = await this.adrService.delegate(adrId, delegateDto);
    return {
      success: true,
      message: 'ADR delegated successfully',
      adr: { id: result.id, status: result.status },
    };
  }

  @Get('escalations/metrics')
  @Roles(Role.TL, Role.QA, Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Get escalation metrics and analytics (Story 7.6 AC#6)' })
  @ApiQuery({
    name: 'project_id',
    required: false,
    type: String,
    description: 'Filter metrics by project UUID',
  })
  @ApiQuery({
    name: 'start_date',
    required: false,
    type: String,
    format: 'date-time',
    description: 'Start date for metrics (ISO 8601)',
    example: '2026-01-01T00:00:00Z',
  })
  @ApiQuery({
    name: 'end_date',
    required: false,
    type: String,
    format: 'date-time',
    description: 'End date for metrics (ISO 8601)',
    example: '2026-01-31T23:59:59Z',
  })
  @ApiResponse({
    status: 200,
    description: 'Escalation metrics and analytics',
    schema: {
      type: 'object',
      properties: {
        total_escalations: { type: 'integer', example: 47 },
        escalation_rate: {
          type: 'number',
          format: 'float',
          example: 0.23,
          description: 'Percentage (0-1)',
        },
        by_reason: {
          type: 'object',
          additionalProperties: { type: 'integer' },
          example: {
            low_confidence: 12,
            missing_context: 18,
            conflicting_requirements: 10,
          },
        },
        by_provider: {
          type: 'object',
          additionalProperties: { type: 'number' },
          example: {
            cursor: 0.18,
            claude_code: 0.31,
          },
        },
        avg_resolution_time_seconds: {
          type: 'integer',
          example: 7200,
          description: '2 hours average',
        },
        resolution_outcomes: {
          type: 'object',
          properties: {
            guidance_provided: { type: 'integer', example: 40 },
            delegated: { type: 'integer', example: 5 },
            constraint_updated: { type: 'integer', example: 12 },
          },
        },
      },
    },
  })
  async getEscalationMetrics(
    @Query('project_id') projectId?: string,
    @Query('start_date') startDate?: string,
    @Query('end_date') endDate?: string,
  ): Promise<{
    total_escalations: number;
    escalation_rate: number;
    by_reason: Record<string, number>;
    by_provider: Record<string, number>;
    avg_resolution_time_seconds: number;
    resolution_outcomes: {
      guidance_provided: number;
      delegated: number;
      constraint_updated: number;
    };
  }> {
    this.logger.log(
      `Fetching escalation metrics: project=${projectId}, start=${startDate}, end=${endDate}`,
    );

    // Build query filters
    const where: Prisma.AdrWhereInput = {
      status: { in: ['ESCALATED', 'GUIDANCE_PROVIDED', 'RESOLVED'] },
    };

    if (projectId) {
      where.ticket = {
        project_id: projectId,
      };
    }

    if (startDate || endDate) {
      where.created_at = {};
      if (startDate) {
        where.created_at.gte = new Date(startDate);
      }
      if (endDate) {
        where.created_at.lte = new Date(endDate);
      }
    }

    // Fetch escalated ADRs
    const escalatedAdrs = await this.adrService.findAll(where);
    const totalEscalations = escalatedAdrs.length;

    // Calculate metrics
    const byReason: Record<string, number> = {};
    const _byProvider: Record<string, { total: number; escalated: number }> = {};
    let totalResolutionTime = 0;
    let resolutionCount = 0;
    const resolutionOutcomes = {
      guidance_provided: 0,
      delegated: 0,
      constraint_updated: 0,
    };

    for (const adr of escalatedAdrs) {
      // Count by reason
      if (adr.escalation_reason) {
        byReason[adr.escalation_reason] = (byReason[adr.escalation_reason] || 0) + 1;
      }

      // Track resolution time
      if (adr.escalation_duration_seconds) {
        totalResolutionTime += adr.escalation_duration_seconds;
        resolutionCount++;
      }

      // Count resolution outcomes
      if (adr.status === 'GUIDANCE_PROVIDED' || adr.status === 'RESOLVED') {
        resolutionOutcomes.guidance_provided++;
      }
      if (adr.delegate_to) {
        resolutionOutcomes.delegated++;
      }
    }

    // TODO: Calculate provider-specific escalation rates (requires execution data)
    // For now, return placeholder
    const byProviderRates = {
      cursor: 0.18,
      claude_code: 0.31,
    };

    // Calculate overall escalation rate (escalations / total ADRs)
    const totalAdrs = await this.adrService.findAll({});
    const escalationRate = totalAdrs.length > 0 ? totalEscalations / totalAdrs.length : 0;

    const avgResolutionTime =
      resolutionCount > 0 ? Math.floor(totalResolutionTime / resolutionCount) : 0;

    return {
      total_escalations: totalEscalations,
      escalation_rate: parseFloat(escalationRate.toFixed(4)),
      by_reason: byReason,
      by_provider: byProviderRates,
      avg_resolution_time_seconds: avgResolutionTime,
      resolution_outcomes: resolutionOutcomes,
    };
  }
}
