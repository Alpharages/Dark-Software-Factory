import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  InternalServerErrorException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
  @HttpCode(HttpStatus.ACCEPTED)
  @Roles(Role.PM, Role.ADMIN, Role.TL)
  @ApiOperation({
    summary: 'Trigger one local MVP OpenHarness run for a ClickUp ticket',
    description:
      'Local MVP endpoint guarded like the existing ExecutionController. It invokes OpenHarness directly through the runner and returns the persisted execution result plus poll/stream hints.',
  })
  @ApiResponse({ status: 202, type: TestExecutionResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid ticket id or run profile' })
  @ApiResponse({ status: 401, description: 'JWT authentication required' })
  @ApiResponse({ status: 403, description: 'Role not allowed to trigger local MVP execution' })
  @ApiResponse({
    status: 500,
    description: 'OpenHarness runner failed before returning an execution id',
  })
  async runTestExecution(@Body() dto: TestExecutionDto): Promise<TestExecutionResponseDto> {
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
