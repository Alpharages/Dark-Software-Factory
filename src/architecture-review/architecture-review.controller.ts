import { Controller, Get, Query, UseGuards, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/common/guards/auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Roles } from '@/common/decorators/roles.decorator';
import { Role } from '@/auth/constants/roles.enum';
import { AdrService } from './adr.service';
import { AdrReviewQueueQueryDto, AdrReviewQueueResponseDto } from './dto';
import { MetricsService } from '@/common/metrics/metrics.service';

@ApiTags('architecture-review')
@ApiBearerAuth()
@Controller('api/v1/architecture-review')
@UseGuards(JwtAuthGuard, RolesGuard, ThrottlerGuard)
export class ArchitectureReviewController {
    private readonly logger = new Logger(ArchitectureReviewController.name);

    constructor(
        private readonly adrService: AdrService,
        private readonly metricsService: MetricsService,
    ) { }

    @Get('queue')
    @Roles(Role.TL, Role.ADMIN)
    @ApiOperation({ summary: 'Get ADR review queue for TL' })
    @ApiQuery({ name: 'status', required: false, enum: ['PROPOSED', 'APPROVED', 'REJECTED', 'MODIFIED', 'DEFERRED'], description: 'Filter by ADR status (default: PROPOSED)' })
    @ApiQuery({ name: 'risk_level', required: false, enum: ['LOW', 'MEDIUM', 'HIGH'], description: 'Filter by risk level' })
    @ApiQuery({ name: 'project_id', required: false, type: String, description: 'Filter by project UUID' })
    @ApiQuery({ name: 'min_confidence', required: false, type: Number, description: 'Minimum AI confidence (0.0-1.0)' })
    @ApiQuery({ name: 'max_confidence', required: false, type: Number, description: 'Maximum AI confidence (0.0-1.0)' })
    @ApiQuery({ name: 'sort_by', required: false, enum: ['risk_level', 'created_at', 'confidence'], description: 'Sort field (default: risk_level)' })
    @ApiQuery({ name: 'sort_order', required: false, enum: ['ASC', 'DESC'], description: 'Sort order (default: DESC)' })
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
                            status: { type: 'string', enum: ['PROPOSED', 'APPROVED', 'REJECTED', 'MODIFIED', 'DEFERRED'] },
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
}
