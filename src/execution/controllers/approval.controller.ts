import { Controller, Post, Body, Param, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { ApprovalService } from '../services/approval.service';
import { ApprovalActionDto, ApprovalResponseDto } from '../dto/approval.dto';
import { JwtAuthGuard } from '@/common/guards/auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { Role } from '@/auth/constants/roles.enum';
import { ApprovalDecision } from '@/prisma/client';

@ApiTags('Execution Approval')
@Controller('api/v1/executions/:id/approve')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ApprovalController {
  constructor(private readonly approvalService: ApprovalService) {}

  @Post()
  @Roles(Role.PM, Role.ADMIN, Role.TL)
  @ApiOperation({ summary: 'Submit an approval decision for an AI execution' })
  @ApiParam({ name: 'id', description: 'Execution UUID' })
  @ApiResponse({ status: 200, type: ApprovalResponseDto })
  async handleApproval(
    @Param('id') id: string,
    @Body() dto: ApprovalActionDto,
    @Req() req: { user: { sub: string } },
  ): Promise<ApprovalResponseDto> {
    const pmId = req.user.sub; // Assuming 'sub' is the user ID from the JWT

    switch (dto.decision) {
      case ApprovalDecision.APPROVE:
        return this.approvalService.approve(id, pmId, dto.reasoning);
      case ApprovalDecision.REJECT:
        return this.approvalService.reject(id, pmId, dto.reasoning || 'No reason provided');
      case ApprovalDecision.REWORK:
        return this.approvalService.rework(id, pmId, dto.reasoning || 'Feedback needed for rework');
      case ApprovalDecision.ESCALATE:
        return this.approvalService.escalate(
          id,
          pmId,
          dto.reasoning || 'Escalated for higher review',
        );
      default:
        throw new Error(`Unsupported decision: ${dto.decision}`);
    }
  }
}
