import { Controller, Get, Post, Body, Param, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { DecisionService, DecisionDto } from './decision.service';
import { JwtAuthGuard } from '../common/guards/auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('Decision Dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('decisions')
export class DecisionDashboardController {
  constructor(private readonly decisionService: DecisionService) {}

  @Get('pending')
  @Roles('PM', 'MANAGER', 'TL')
  @ApiOperation({ summary: 'Get list of pending/blocked tickets' })
  async getPendingTickets() {
    return this.decisionService.getPendingTickets();
  }

  @Post(':ticketId/decision')
  @Roles('PM', 'MANAGER')
  @ApiOperation({ summary: 'Submit approve/reject decision' })
  async submitDecision(
    @Param('ticketId') ticketId: string,
    @Body() decisionDto: DecisionDto,
    @Req() req: { user: { id: string; role?: string } },
  ) {
    // Extract user ID and role from JWT
    const userId = req.user?.id || 'unknown';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userRole = (req.user as any)?.role || 'unknown';
    return this.decisionService.processDecision(ticketId, userId, userRole, decisionDto);
  }

  @Post(':ticketId/override')
  @Roles('MANAGER')
  @ApiOperation({ summary: 'Override and force-approve ticket (Manager only)' })
  async overrideDecision(
    @Param('ticketId') ticketId: string,
    @Body() body: { reason: string },
    @Req() req: { user: { id: string; role?: string } },
  ) {
    const userId = req.user?.id || 'unknown';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userRole = (req.user as any)?.role || 'MANAGER';
    return this.decisionService.processDecision(ticketId, userId, userRole, {
      decision: 'OVERRIDE',
      reason: body.reason,
      override: true,
    });
  }

  @Get('metrics')
  @Roles('PM', 'MANAGER', 'TL')
  @ApiOperation({ summary: 'Get aggregate decision metrics' })
  async getMetrics() {
    // Placeholder for metrics aggregation
    const pending = await this.decisionService.getPendingTickets();
    const totalBlockedCost = pending.reduce((sum, t) => sum + (t.costStats?.totalCost || 0), 0);
    return {
      pendingCount: pending.length,
      totalBlockedCost,
    };
  }
}
