import { Controller, Post, Body, UseGuards, Req } from '@nestjs/common';
import { ProductionApprovalService } from './production-approval.service';
import { RolesGuard, JwtAuthGuard } from '../../common/guards';
import { Roles } from '../../common/decorators/roles.decorator';
import { IsString, IsOptional, IsNotEmpty } from 'class-validator';

// DTOs
export class ApproveReleaseDto {
  @IsString()
  @IsNotEmpty()
  ticketId!: string;

  @IsString()
  @IsOptional()
  overrideReason?: string;
}

export class RejectReleaseDto {
  @IsString()
  @IsNotEmpty()
  ticketId!: string;

  @IsString()
  @IsNotEmpty()
  rejectionReason!: string;
}

// Interface for authenticated request
interface AuthenticatedRequest {
  user?: {
    sub?: string;
    id?: string;
  };
}

@Controller('production-approval')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProductionApprovalController {
  constructor(private readonly approvalService: ProductionApprovalService) {}

  @Post('approve')
  @Roles('LEAD_QA', 'PM', 'ADMIN')
  async approveRelease(@Body() dto: ApproveReleaseDto, @Req() req: AuthenticatedRequest) {
    // Assuming user ID is available in req.user.sub or req.user.id
    const approverId = req.user?.sub || req.user?.id || 'unknown-user';
    return this.approvalService.approveRelease(dto.ticketId, approverId, dto.overrideReason);
  }

  @Post('reject')
  @Roles('LEAD_QA', 'PM', 'ADMIN')
  async rejectRelease(@Body() dto: RejectReleaseDto, @Req() req: AuthenticatedRequest) {
    const approverId = req.user?.sub || req.user?.id || 'unknown-user';
    return this.approvalService.rejectRelease(dto.ticketId, approverId, dto.rejectionReason);
  }
}
