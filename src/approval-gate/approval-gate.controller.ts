import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ApprovalDecision } from '@/prisma/client';
import { Role } from '@/auth/constants/roles.enum';
import { Roles } from '@/common/decorators/roles.decorator';
import { JwtAuthGuard, RolesGuard } from '@/common/guards';
import { ApprovalGateService } from './approval-gate.service';

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
  @Roles(Role.PM, Role.TL, Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'List executions awaiting human approval' })
  pendingApprovals() {
    return this.approvalGate.pendingApprovals();
  }

  @Post(':id/gate-decision')
  @Roles(Role.PM, Role.TL, Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Record approval-gate decision for an execution' })
  recordDecision(
    @Param('id') executionId: string,
    @Body() body: GateDecisionDto,
    @Req() req: { user?: { id?: string; sub?: string } },
  ) {
    return this.approvalGate.recordDecision({
      executionId,
      deciderId: req.user?.id ?? req.user?.sub ?? 'unknown',
      decision: body.decision,
      reasoning: body.reasoning,
    });
  }
}
