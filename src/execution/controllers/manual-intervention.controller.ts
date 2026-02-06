import {
  Controller,
  Post,
  Param,
  Body,
  Request,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ManualInterventionService } from '../services/manual-intervention.service';
import {
  PauseExecutionDto,
  ResumeExecutionDto,
  EmergencyStopDto,
  OverrideDecisionDto,
  ExecutionControlResponse,
  DecisionOverrideResponse,
} from '../dto';
import { ExecutionStatus } from '@/prisma/client';

/**
 * Controller for manual intervention in AI executions
 * Story 10-U-5: Manual Intervention Circuit Breaker
 *
 * Provides REST API endpoints for:
 * - Pausing and resuming executions
 * - Emergency stopping executions
 * - Overriding AI decisions
 *
 * All endpoints require JWT authentication and appropriate RBAC.
 */
@ApiTags('Execution Manual Intervention')
@ApiBearerAuth()
@Controller('execution')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ManualInterventionController {
  constructor(private readonly manualInterventionService: ManualInterventionService) {}

  /**
   * Pause a running execution
   * Transitions execution from IN_PROGRESS → PAUSED
   *
   * RBAC: PM, TL, MANAGER, ADMIN
   */
  @Post(':id/pause')
  @Roles('PM', 'TL', 'MANAGER', 'ADMIN')
  @ApiOperation({
    summary: 'Pause a running execution',
    description: 'Pauses an IN_PROGRESS execution. The container is suspended but not terminated.',
  })
  @ApiParam({ name: 'id', description: 'Execution ID', type: String })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Execution paused successfully',
    type: ExecutionControlResponse,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid execution state or not found',
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'Execution already paused or in terminal state',
  })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Insufficient permissions' })
  @HttpCode(HttpStatus.OK)
  async pauseExecution(
    @Param('id') executionId: string,
    @Body() dto: PauseExecutionDto,
    @Request() req: { user: { userId: string } },
  ): Promise<ExecutionControlResponse> {
    const userId = req.user.userId;

    const result = await this.manualInterventionService.pauseExecution(
      executionId,
      userId,
      dto.reason,
    );

    return {
      executionId: result.execution.id,
      status: result.execution.status as ExecutionStatus,
      timestamp: new Date().toISOString(),
      performedBy: userId,
      reason: dto.reason,
      containerControlSkipped: result.containerControlSkipped,
    };
  }

  /**
   * Resume a paused execution
   * Transitions execution from PAUSED → IN_PROGRESS
   *
   * RBAC: PM, TL, MANAGER, ADMIN
   */
  @Post(':id/resume')
  @Roles('PM', 'TL', 'MANAGER', 'ADMIN')
  @ApiOperation({
    summary: 'Resume a paused execution',
    description: 'Resumes a PAUSED execution. The container is resumed if it exists.',
  })
  @ApiParam({ name: 'id', description: 'Execution ID', type: String })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Execution resumed successfully',
    type: ExecutionControlResponse,
  })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Execution not in PAUSED state' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Insufficient permissions' })
  @HttpCode(HttpStatus.OK)
  async resumeExecution(
    @Param('id') executionId: string,
    @Body() dto: ResumeExecutionDto,
    @Request() req: { user: { userId: string } },
  ): Promise<ExecutionControlResponse> {
    const userId = req.user.userId;

    const result = await this.manualInterventionService.resumeExecution(
      executionId,
      userId,
      dto.resumeNotes,
    );

    return {
      executionId: result.execution.id,
      status: result.execution.status as ExecutionStatus,
      timestamp: new Date().toISOString(),
      performedBy: userId,
      resumeNotes: dto.resumeNotes,
      containerControlSkipped: result.containerControlSkipped,
    };
  }

  /**
   * Emergency stop an execution
   * Transitions execution to EMERGENCY_STOPPED (terminal state)
   *
   * RBAC: TL, MANAGER, ADMIN (elevated privilege)
   */
  @Post(':id/emergency-stop')
  @Roles('TL', 'MANAGER', 'ADMIN')
  @ApiOperation({
    summary: 'Emergency stop an execution',
    description:
      'Immediately stops an execution. This is a terminal state - the execution cannot be resumed.',
  })
  @ApiParam({ name: 'id', description: 'Execution ID', type: String })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Execution emergency stopped successfully',
    type: ExecutionControlResponse,
  })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Execution not found' })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'Execution already in terminal state' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Insufficient permissions' })
  @HttpCode(HttpStatus.OK)
  async emergencyStop(
    @Param('id') executionId: string,
    @Body() dto: EmergencyStopDto,
    @Request() req: { user: { userId: string } },
  ): Promise<ExecutionControlResponse> {
    const userId = req.user.userId;

    const result = await this.manualInterventionService.emergencyStop(
      executionId,
      userId,
      dto.reason,
      dto.killContainer,
    );

    return {
      executionId: result.execution.id,
      status: result.execution.status as ExecutionStatus,
      timestamp: new Date().toISOString(),
      performedBy: userId,
      reason: dto.reason,
      containerControlSkipped: result.containerControlSkipped,
    };
  }

  /**
   * Override an AI decision
   * Creates an override record with full audit trail
   *
   * RBAC: TL, ADMIN (critical operation)
   */
  @Post(':id/override-decision')
  @Roles('TL', 'ADMIN')
  @ApiOperation({
    summary: 'Override an AI decision',
    description: 'Overrides an AI decision with human judgment. Full audit trail is maintained.',
  })
  @ApiParam({ name: 'id', description: 'Execution ID', type: String })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Decision overridden successfully',
    type: DecisionOverrideResponse,
  })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Execution not found' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Insufficient permissions' })
  @HttpCode(HttpStatus.OK)
  async overrideDecision(
    @Param('id') executionId: string,
    @Body() dto: OverrideDecisionDto,
    @Request() req: { user: { userId: string } },
  ): Promise<DecisionOverrideResponse> {
    const userId = req.user.userId;

    const result = await this.manualInterventionService.overrideDecision(
      executionId,
      userId,
      dto.decision,
      dto.reason,
      dto.overrideData,
    );

    return {
      executionId: result.execution.id,
      decisionOverridden: true,
      overriddenBy: userId,
      overriddenAt: new Date().toISOString(),
      originalDecision: null, // Will be populated by service if available
      newDecision: dto.decision,
      reason: dto.reason,
    };
  }
}
