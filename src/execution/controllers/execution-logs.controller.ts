import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
// Assuming RoleGuard and JwtAuthGuard exist - verifying imports from execution.module.ts
import { JwtAuthGuard } from '@/common/guards/auth.guard'; // More specific import to match file system
import { RolesGuard } from '@/common/guards/roles.guard';
import { ExecutionLogRepository } from '../repositories/execution-log.repository';
import { ExecutionActivityRepository } from '../repositories/execution-activity.repository';

@ApiTags('Execution Logs')
@Controller('executions')
@UseGuards(JwtAuthGuard, RolesGuard)
// JWT+Roles-guarded read-only telemetry. The live activity timeline fires one
// fetch per on-screen execution, so a dashboard load bursts well past the global
// 100/min 'webhook' throttle. Raise the ceiling like the audit/production dashboards.
// ponytail: fixed 300/min ceiling; if pages routinely show >300 executions, key the throttle per-user instead of per-IP.
@Throttle({ default: { limit: 300, ttl: 60000 } })
export class ExecutionLogsController {
  constructor(
    private readonly logRepository: ExecutionLogRepository,
    private readonly activityRepository: ExecutionActivityRepository,
  ) {}

  @Get(':id/logs')
  @ApiOperation({ summary: 'Get execution logs' })
  @ApiQuery({
    name: 'level',
    required: false,
    description: 'Filter by log levels (comma separated: ERROR,WARN)',
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getLogs(
    @Param('id') executionId: string,
    @Query('level') levels?: string | string[],
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit = 100,
  ) {
    const levelFilter = levels ? (Array.isArray(levels) ? levels : levels.split(',')) : undefined;

    const [logs, total] = await this.logRepository.findByExecution(
      executionId,
      levelFilter,
      page,
      limit,
    );

    return {
      logs,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Get execution activities (live activity timeline)
   *
   * Returns persisted structured activity events for timeline display.
   * Each activity includes `rawContent` for expandable drill-down view.
   */
  @Get(':id/activities')
  @ApiOperation({ summary: 'Get execution live activity timeline' })
  @ApiQuery({
    name: 'category',
    required: false,
    description:
      'Filter by categories (comma separated: ERROR,AI_THINKING,AI_CODING,SETUP,DEPENDENCY,GIT,BUILD,TEST,LINT,FILE_OP,DEPLOY,SYSTEM)',
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getActivities(
    @Param('id') executionId: string,
    @Query('category') categories?: string | string[],
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('limit', new DefaultValuePipe(200), ParseIntPipe) limit = 200,
  ) {
    const categoryFilter = categories
      ? Array.isArray(categories)
        ? categories
        : categories.split(',')
      : undefined;

    const [activities, total] = await this.activityRepository.findByExecution(executionId, {
      categories: categoryFilter,
      page,
      limit,
    });

    return {
      activities,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Get the latest N activities (for dashboard widget)
   */
  @Get(':id/activities/latest')
  @ApiOperation({ summary: 'Get latest execution activities for dashboard' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getLatestActivities(
    @Param('id') executionId: string,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit = 20,
  ) {
    const activities = await this.activityRepository.findLatest(executionId, limit);

    return {
      activities,
    };
  }
}
