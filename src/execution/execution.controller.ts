import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  NotFoundException,
  HttpCode,
  HttpStatus,
  Headers,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { ExecutionService } from './execution.service';
import { ExecutionResponseDto, ResolveQaFailureDto } from '@/execution/dto';
import { JwtAuthGuard } from '@/common/guards/auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { Role } from '@/auth/constants/roles.enum';
import {
  QAFailureResolutionService,
  QAResolutionResult,
} from './services/qa-failure-resolution.service';

@ApiTags('Execution')
@Controller('executions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ExecutionController {
  constructor(
    private readonly executionService: ExecutionService,
    private readonly resolutionService: QAFailureResolutionService,
  ) {}

  @Get()
  @Roles(Role.PM, Role.ADMIN, Role.TL, Role.MANAGER)
  @ApiOperation({ summary: 'Get recent executions, including terminal history' })
  async getExecutions(): Promise<{ executions: ExecutionResponseDto[]; total: number }> {
    const executions = await this.executionService.getExecutions();
    return { executions, total: executions.length };
  }

  @Get('active')
  @Roles(Role.PM, Role.ADMIN, Role.TL, Role.MANAGER)
  @ApiOperation({ summary: 'Get active executions' })
  async getActiveExecutions(): Promise<{ executions: ExecutionResponseDto[]; total: number }> {
    const executions = await this.executionService.getActiveExecutions();
    return {
      executions,
      total: executions.length,
    };
  }

  @Post(':id/resolve-qa-failure')
  @Roles(Role.PM, Role.ADMIN, Role.TL)
  @ApiOperation({ summary: 'Resolve a QA-failed execution: open PR or cancel (Story WR-4.3)' })
  @ApiParam({ name: 'id', description: 'Execution UUID' })
  @ApiResponse({
    status: 201,
    description: 'Resolution applied — returns prUrl+prNumber (open_pr) or branchName (cancel)',
  })
  @ApiResponse({ status: 404, description: 'Execution not found' })
  @ApiResponse({ status: 409, description: 'Execution is not in QA_FAILED state' })
  @ApiResponse({ status: 422, description: 'open_pr called but no pushed branch exists' })
  async resolveQaFailure(
    @Param('id') id: string,
    @Body() dto: ResolveQaFailureDto,
    @Headers('x-correlation-id') correlationId?: string,
  ): Promise<QAResolutionResult> {
    const corrId = correlationId ?? `wr-4.3-${id.slice(0, 8)}`;
    return this.resolutionService.resolve(id, dto, corrId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.PM, Role.ADMIN)
  @ApiOperation({ summary: 'Delete an execution and its associated records' })
  @ApiParam({ name: 'id', description: 'Execution UUID' })
  @ApiResponse({ status: 204, description: 'Execution deleted' })
  @ApiResponse({ status: 404, description: 'Execution not found' })
  async deleteExecution(@Param('id') id: string): Promise<void> {
    await this.executionService.deleteExecution(id);
  }

  @Get(':id/status')
  // ...
  @Roles(Role.PM, Role.ADMIN, Role.TL)
  @ApiOperation({ summary: 'Get current execution status for polling fallback' })
  @ApiParam({ name: 'id', description: 'Execution UUID' })
  @ApiResponse({ status: 200, type: ExecutionResponseDto })
  @ApiResponse({ status: 404, description: 'Execution not found' })
  async getStatus(@Param('id') id: string): Promise<ExecutionResponseDto> {
    const execution = await this.executionService.getExecution(id);
    if (!execution) {
      throw new NotFoundException(`Execution with ID ${id} not found`);
    }
    return execution;
  }
}
