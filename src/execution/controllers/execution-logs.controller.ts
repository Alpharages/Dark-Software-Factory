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
// Assuming RoleGuard and JwtAuthGuard exist - verifying imports from execution.module.ts
import { JwtAuthGuard } from '@/common/guards/auth.guard'; // More specific import to match file system
import { RolesGuard } from '@/common/guards/roles.guard';
import { ExecutionLogRepository } from '../repositories/execution-log.repository';

@ApiTags('Execution Logs')
@Controller('execution')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ExecutionLogsController {
  constructor(private readonly logRepository: ExecutionLogRepository) {}

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
    @Query('level') levels?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit = 100,
  ) {
    const levelFilter = levels ? levels.split(',') : undefined;

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
}
