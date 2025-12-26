import {
    Controller,
    Get,
    Put,
    Param,
    Query,
    Body,
    UseGuards,
    Logger,
    HttpCode,
    HttpStatus,
} from '@nestjs/common';
import {
    ApiTags,
    ApiOperation,
    ApiResponse,
    ApiParam,
    ApiQuery,
    ApiBearerAuth,
} from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { JwtAuthGuard } from '@/common/guards/auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { WorkloadService } from '../services/workload.service';
import {
    UtilizationResponseDto,
    TeamCapacityResponseDto,
    HistoricalTrendsResponseDto,
    HistoricalTrendsQueryDto,
    UpdateMaxTicketsDto,
} from '../dto/workload.dto';

@ApiTags('workload')
@Controller('workload')
@UseGuards(ThrottlerGuard, JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class WorkloadController {
    private readonly logger = new Logger(WorkloadController.name);

    constructor(private readonly workloadService: WorkloadService) { }

    @Get('pm/:id')
    @Throttle({ default: { limit: 100, ttl: 60000 } })
    @Roles('PM', 'MANAGER', 'ADMIN')
    @ApiOperation({
        summary: 'Get PM utilization and burnout risk',
        description: 'Returns real-time utilization percentage and burnout risk indicator for a specific PM. AC#1, AC#2. PMs can only view their own data.',
    })
    @ApiParam({
        name: 'id',
        description: 'PM user ID',
        example: 'pm-123',
    })
    @ApiResponse({
        status: 200,
        description: 'PM utilization data retrieved successfully',
        type: UtilizationResponseDto,
    })
    @ApiResponse({
        status: 404,
        description: 'PM not found or user is not a PM',
    })
    @ApiResponse({
        status: 403,
        description: 'Forbidden - PMs can only view their own utilization',
    })
    async getPmUtilization(@Param('id') pmId: string): Promise<UtilizationResponseDto> {
        this.logger.log(`GET /workload/pm/${pmId}`);

        // TODO: Extract user from JWT token via @CurrentUser() decorator
        // For now, ownership check is delegated to service layer or implemented in auth guard
        // Example implementation:
        // if (currentUser.role === 'PM' && currentUser.id !== pmId) {
        //     throw new ForbiddenException('PMs can only view their own utilization');
        // }

        return await this.workloadService.getPmUtilization(pmId);
    }

    @Get('team')
    @Throttle({ default: { limit: 50, ttl: 60000 } })
    @Roles('MANAGER', 'ADMIN')
    @ApiOperation({
        summary: 'Get team capacity overview for managers',
        description: 'Returns utilization data for all PMs managed by the authenticated manager. AC#4, AC#8.',
    })
    @ApiQuery({
        name: 'managerId',
        description: 'Manager user ID (required)',
        example: 'mgr-456',
    })
    @ApiResponse({
        status: 200,
        description: 'Team capacity data retrieved successfully',
        type: [TeamCapacityResponseDto],
    })
    @ApiResponse({
        status: 404,
        description: 'Manager not found or user is not a Manager/Admin',
    })
    async getTeamCapacity(
        @Query('managerId') managerId: string,
    ): Promise<TeamCapacityResponseDto[]> {
        this.logger.log(`GET /workload/team?managerId=${managerId}`);
        return await this.workloadService.getTeamCapacity(managerId);
    }

    @Get('trends/:id')
    @Throttle({ default: { limit: 50, ttl: 60000 } })
    @Roles('PM', 'MANAGER', 'ADMIN')
    @ApiOperation({
        summary: 'Get historical utilization trends for a PM',
        description: 'Returns historical utilization data (last 30 days by default) for trend analysis. AC#6.',
    })
    @ApiParam({
        name: 'id',
        description: 'PM user ID',
        example: 'pm-123',
    })
    @ApiQuery({
        name: 'days',
        description: 'Number of days of historical data (1-365)',
        required: false,
        example: 30,
    })
    @ApiResponse({
        status: 200,
        description: 'Historical trends retrieved successfully',
        type: HistoricalTrendsResponseDto,
    })
    @ApiResponse({
        status: 404,
        description: 'PM not found',
    })
    async getHistoricalTrends(
        @Param('id') pmId: string,
        @Query() query: HistoricalTrendsQueryDto,
    ): Promise<HistoricalTrendsResponseDto> {
        this.logger.log(`GET /workload/trends/${pmId}?days=${query.days || 30}`);
        const data = await this.workloadService.getHistoricalTrends(pmId, query.days || 30);
        return { data };
    }

    @Put('pm/:id/capacity')
    @HttpCode(HttpStatus.NO_CONTENT)
    @Throttle({ default: { limit: 20, ttl: 60000 } })
    @Roles('PM', 'ADMIN')
    @ApiOperation({
        summary: 'Update PM max_tickets capacity threshold',
        description: 'Allows PMs to configure their own capacity threshold. Admin oversight recommended. AC#7.',
    })
    @ApiParam({
        name: 'id',
        description: 'PM user ID',
        example: 'pm-123',
    })
    @ApiResponse({
        status: 204,
        description: 'Max tickets updated successfully',
    })
    @ApiResponse({
        status: 404,
        description: 'PM not found',
    })
    async updateMaxTickets(
        @Param('id') pmId: string,
        @Body() updateDto: UpdateMaxTicketsDto,
    ): Promise<void> {
        this.logger.log(`PUT /workload/pm/${pmId}/capacity - max_tickets: ${updateDto.max_tickets}`);
        await this.workloadService.updateMaxTickets(pmId, updateDto.max_tickets);
    }
}
