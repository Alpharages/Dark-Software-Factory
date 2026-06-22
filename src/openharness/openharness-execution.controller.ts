import {
  Body,
  Controller,
  HttpStatus,
  InternalServerErrorException,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyReply } from 'fastify';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@/auth/constants/roles.enum';
import { Roles } from '@/common/decorators/roles.decorator';
import { JwtAuthGuard } from '@/common/guards/auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { ExecutionRepository } from '@/execution/execution.repository';
import { ExecutionStatus } from '@/prisma/client';
import { TestExecutionDto } from './dto/test-execution.dto';
import { OpenHarnessRunOptions, OpenHarnessRunnerService } from './openharness-runner.service';

const EXECUTION_STATUS_VALUES = [...Object.values(ExecutionStatus), 'UNKNOWN'] as const;

export class TestExecutionResponseDto {
  @ApiProperty({ description: 'Persisted execution id' })
  executionId!: string;

  @ApiProperty({ enum: EXECUTION_STATUS_VALUES, description: 'Persisted execution status' })
  status!: ExecutionStatus | 'UNKNOWN';

  @ApiPropertyOptional({ description: 'Execution summary or failure message when available' })
  summary?: string;

  @ApiProperty({ type: [String], description: 'Files changed by the OpenHarness run' })
  filesChanged!: string[];

  @ApiProperty({ description: 'HTTP polling endpoint for execution status' })
  pollUrl!: string;

  @ApiProperty({ description: 'Dashboard stream hint for live Socket.IO activity' })
  streamUrl!: string;
}

@ApiTags('OpenHarness')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'executions', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class OpenHarnessExecutionController {
  constructor(
    private readonly runner: OpenHarnessRunnerService,
    private readonly executionRepository: ExecutionRepository,
    private readonly configService: ConfigService,
  ) {}

  @Post('test')
  @Roles(Role.PM, Role.ADMIN, Role.TL)
  @ApiOperation({
    summary: 'Trigger one local MVP OpenHarness run for a ClickUp ticket',
    description:
      'Local MVP endpoint guarded like the existing ExecutionController. It invokes OpenHarness directly through the runner and blocks until the run reaches a terminal state, then returns the persisted execution result plus poll/stream hints. The HTTP status mirrors the terminal execution status: 200 on success, 504 on runner timeout, 5xx on a failed run (AC5).',
  })
  @ApiResponse({ status: 200, type: TestExecutionResponseDto, description: 'Run completed' })
  @ApiResponse({ status: 400, description: 'Invalid ticket id or run profile' })
  @ApiResponse({ status: 401, description: 'JWT authentication required' })
  @ApiResponse({ status: 403, description: 'Role not allowed to trigger local MVP execution' })
  @ApiResponse({
    status: 500,
    description:
      'OpenHarness run failed (terminal FAILED/CANCELLED status) or the runner errored before returning an execution id. Body still carries the persisted execution when one exists.',
    type: TestExecutionResponseDto,
  })
  @ApiResponse({
    status: 504,
    description: 'OpenHarness run exceeded its wall-clock budget (terminal TIMEOUT status)',
    type: TestExecutionResponseDto,
  })
  async runTestExecution(
    @Body() dto: TestExecutionDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<TestExecutionResponseDto> {
    const profile: OpenHarnessRunOptions = {
      skill: dto.skill ?? this.requiredConfig<string>('openharness.defaultSkill'),
      workspaceDir: dto.workspaceDir ?? this.requiredConfig<string>('openharness.workspaceDir'),
      maxTurns: dto.maxTurns ?? this.requiredConfig<number>('openharness.maxTurns'),
      mcpConfigPath: dto.mcpConfigPath ?? this.requiredConfig<string>('openharness.mcpConfigPath'),
    };

    try {
      const executionId = await this.runner.runForTicket(dto.ticketId, profile);
      const execution = await this.executionRepository.findById(executionId);
      const status =
        execution?.status && EXECUTION_STATUS_VALUES.includes(execution.status)
          ? execution.status
          : 'UNKNOWN';

      // AC5: surface the terminal outcome through the HTTP status so a runner
      // failure reads as an error to API clients, not a 2xx. The body still
      // carries the persisted execution (id + status + summary) in every case.
      reply.status(this.httpStatusForExecution(status));

      return {
        executionId,
        status,
        summary: execution?.code_output ?? execution?.error_message ?? undefined,
        filesChanged: this.normalizeFilesChanged(execution?.files_changed),
        pollUrl: `/api/v1/executions/${executionId}/status`,
        streamUrl: `socket.io:/execution?room=execution_logs_${executionId}`,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new InternalServerErrorException({
        message: 'OpenHarness test execution failed',
        ticketId: dto.ticketId,
        error: message,
      });
    }
  }

  /**
   * Map a terminal execution status to an HTTP status code (AC5):
   * COMPLETED → 200, TIMEOUT → 504, anything else (FAILED/CANCELLED/UNKNOWN) → 500.
   */
  private httpStatusForExecution(status: ExecutionStatus | 'UNKNOWN'): number {
    switch (status) {
      case ExecutionStatus.COMPLETED:
        return HttpStatus.OK;
      case ExecutionStatus.TIMEOUT:
        return HttpStatus.GATEWAY_TIMEOUT;
      default:
        return HttpStatus.INTERNAL_SERVER_ERROR;
    }
  }

  private requiredConfig<T>(key: string): T {
    const value = this.configService.get<T>(key);
    if (value === undefined || value === null || value === '') {
      throw new InternalServerErrorException({
        message: 'OpenHarness test execution is not configured',
        configKey: key,
      });
    }
    return value;
  }

  private normalizeFilesChanged(filesChanged: unknown): string[] {
    if (!Array.isArray(filesChanged)) {
      return [];
    }
    return filesChanged.filter((file): file is string => typeof file === 'string');
  }
}
