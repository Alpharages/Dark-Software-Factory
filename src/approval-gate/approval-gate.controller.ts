import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ApprovalDecision } from '@/prisma/client';
import { Role } from '@/auth/constants/roles.enum';
import { AuthenticatedUser } from '@/auth/interfaces/jwt-payload.interface';
import { Roles } from '@/common/decorators/roles.decorator';
import { JwtAuthGuard, RolesGuard } from '@/common/guards';
import { ApprovalGateService } from './approval-gate.service';

/** Single source of truth for the roles allowed to operate the approval gate. */
const APPROVER_ROLES = [Role.ADMIN, Role.MANAGER, Role.PM, Role.TL];

class GateDecisionDto {
  @IsEnum(ApprovalDecision)
  decision!: ApprovalDecision;

  @IsOptional()
  @IsString()
  reasoning?: string;
}

@ApiTags('Approval Gate')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('executions')
export class ApprovalGateController {
  constructor(private readonly approvalGate: ApprovalGateService) {}

  @Get('approval-gate/pending')
  @Roles(...APPROVER_ROLES)
  @ApiOperation({ summary: 'List executions awaiting human approval' })
  pendingApprovals(@Query('projectId') projectId?: string) {
    return this.approvalGate.pendingApprovals(projectId);
  }

  @Post(':id/gate-decision')
  @Roles(...APPROVER_ROLES)
  @ApiOperation({ summary: 'Record approval-gate decision for an execution' })
  recordDecision(
    @Param('id') executionId: string,
    @Body() body: GateDecisionDto,
    @Req() req: { user?: AuthenticatedUser },
  ) {
    const deciderId = req.user?.id;
    if (!deciderId) {
      // Fail closed — an approval must always be attributable (AC7 / NFR-S5).
      throw new UnauthorizedException('Authenticated user id is required to record a decision');
    }
    return this.approvalGate.recordDecision({
      executionId,
      deciderId,
      decision: body.decision,
      reasoning: body.reasoning,
    });
  }
}
