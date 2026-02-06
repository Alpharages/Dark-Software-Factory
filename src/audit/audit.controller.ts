import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  HttpStatus,
  HttpException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '@/common/guards/auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Roles } from '@/common/decorators/roles.decorator';
import { CorrelationId } from '@/common/decorators/correlation-id.decorator';
import { Role } from '@/auth/constants/roles.enum';
import { LoggerService } from '@/common/logger/logger.service';
import { AIDecisionLoggerService } from './ai-decision-logger.service';
import {
  AuditTimelineResponseDto,
  LowConfidenceQueryDto,
  LowConfidenceResponseDto,
  AuditSearchQueryDto,
  AuditSearchResponseDto,
} from './dto';

@ApiTags('Audit Logs')
@ApiBearerAuth()
@Controller('audit')
@UseGuards(JwtAuthGuard, RolesGuard, ThrottlerGuard)
export class AuditController {
  constructor(
    private readonly auditService: AIDecisionLoggerService,
    private readonly logger: LoggerService,
  ) {}

  /**
   * AC#1: Get complete decision timeline for a ticket
   */
  @Get('timeline/:ticketId')
  @Roles(Role.PM, Role.TL, Role.QA, Role.MANAGER, Role.ADMIN)
  @Throttle({ default: { limit: 100, ttl: 60000 } }) // 100/min
  @ApiOperation({
    summary: 'Get complete audit trail for a ticket',
    description:
      'Returns chronological decision history for a ticket ordered by timestamp (oldest first). Includes all AI decision logs with related execution data.',
  })
  @ApiParam({
    name: 'ticketId',
    description: 'Ticket ID (e.g., DSF-123)',
    example: 'DSF-123',
  })
  @ApiResponse({
    status: 200,
    description: 'Timeline retrieved successfully',
    type: AuditTimelineResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized - JWT required' })
  @ApiResponse({ status: 403, description: 'Forbidden - insufficient role' })
  @ApiResponse({
    status: 404,
    description: 'Ticket not found or no decisions logged',
  })
  async getTimeline(
    @Param('ticketId') ticketId: string,
    @CorrelationId() correlationId?: string,
  ): Promise<AuditTimelineResponseDto> {
    this.logger.debug(`Getting timeline for ticket ${ticketId}`, {
      correlationId,
    });

    const decisions = await this.auditService.getDecisionTimeline(ticketId, correlationId);

    return {
      ticketId,
      decisions,
      totalDecisions: decisions.length,
    };
  }

  /**
   * AC#2: Get low-confidence decisions requiring review
   */
  @Get('low-confidence')
  @Roles(Role.TL, Role.QA, Role.MANAGER, Role.ADMIN) // NO PM access
  @Throttle({ default: { limit: 50, ttl: 60000 } }) // 50/min
  @ApiOperation({
    summary: 'Get low-confidence decisions for review queue',
    description:
      'Returns paginated decisions with confidence below threshold for human review. Ordered by timestamp (newest first).',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    description: 'Page number (default: 1)',
    example: 1,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Items per page (default: 50, max: 100)',
    example: 50,
  })
  @ApiQuery({
    name: 'minConfidence',
    required: false,
    description: 'Confidence threshold (default: 0.5)',
    example: 0.5,
  })
  @ApiResponse({
    status: 200,
    description: 'Low-confidence decisions retrieved successfully',
    type: LowConfidenceResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Bad Request - invalid parameters' })
  @ApiResponse({ status: 401, description: 'Unauthorized - JWT required' })
  @ApiResponse({ status: 403, description: 'Forbidden - insufficient role' })
  async getLowConfidence(
    @Query() queryDto: LowConfidenceQueryDto,
    @CorrelationId() correlationId?: string,
  ): Promise<LowConfidenceResponseDto> {
    this.logger.debug(`Getting low-confidence decisions`, {
      filters: queryDto,
      correlationId,
    });

    return this.auditService.getLowConfidenceDecisions(
      {
        page: queryDto.page || 1,
        limit: queryDto.limit || 50,
        minConfidence: queryDto.minConfidence || 0.5,
      },
      correlationId,
    );
  }

  /**
   * AC#3: Search audit logs with flexible filters
   */
  @Get('search')
  @Roles(Role.TL, Role.QA, Role.MANAGER, Role.ADMIN) // NO PM access
  @Throttle({ default: { limit: 20, ttl: 60000 } }) // 20/min (expensive queries)
  @ApiOperation({
    summary: 'Search audit logs with filters',
    description:
      'Flexible search with optional filters. Supports filtering by agent, action, ticket, execution, and date range. Results ordered by timestamp (newest first).',
  })
  @ApiQuery({
    name: 'agent_name',
    required: false,
    description: 'Filter by agent name',
    example: 'AIExecutionConsumer',
  })
  @ApiQuery({
    name: 'action',
    required: false,
    description: 'Filter by action type',
    example: 'ai_provider_selection',
  })
  @ApiQuery({
    name: 'ticketId',
    required: false,
    description: 'Filter by ticket ID',
    example: 'DSF-123',
  })
  @ApiQuery({
    name: 'executionId',
    required: false,
    description: 'Filter by execution ID (UUID)',
    example: 'exec-uuid',
  })
  @ApiQuery({
    name: 'startDate',
    required: false,
    description: 'Start date (ISO 8601 format)',
    example: '2025-12-20T00:00:00.000Z',
  })
  @ApiQuery({
    name: 'endDate',
    required: false,
    description: 'End date (ISO 8601 format)',
    example: '2025-12-22T23:59:59.999Z',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    description: 'Page number (default: 1)',
    example: 1,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Items per page (default: 50, max: 100)',
    example: 50,
  })
  @ApiResponse({
    status: 200,
    description: 'Search results retrieved successfully',
    type: AuditSearchResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request - invalid filters or date format',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized - JWT required' })
  @ApiResponse({ status: 403, description: 'Forbidden - insufficient role' })
  async search(
    @Query() queryDto: AuditSearchQueryDto,
    @CorrelationId() correlationId?: string,
  ): Promise<AuditSearchResponseDto> {
    this.logger.debug(`Searching audit logs`, {
      filters: queryDto,
      correlationId,
    });

    try {
      return await this.auditService.searchDecisions(
        {
          agent_name: queryDto.agent_name,
          action: queryDto.action,
          ticketId: queryDto.ticketId,
          executionId: queryDto.executionId,
          startDate: queryDto.startDate ? new Date(queryDto.startDate) : undefined,
          endDate: queryDto.endDate ? new Date(queryDto.endDate) : undefined,
          page: queryDto.page || 1,
          limit: queryDto.limit || 50,
        },
        correlationId,
      );
    } catch (_error) {
      const err = _error as Error;
      if (err.message.includes('Invalid date')) {
        throw new HttpException(
          'Invalid date format. Use ISO 8601 format (e.g., 2025-12-22T10:00:00.000Z).',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw _error;
    }
  }
}
