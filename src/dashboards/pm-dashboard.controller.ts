import { Controller, Get, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { PmDashboardService, UserRole } from './services/pm-dashboard.service';
import { MetricsService } from '@/common/metrics/metrics.service';
import { ProjectQueryDto, TicketSearchQueryDto } from './dto/pm-dashboard.dto';
import { JwtAuthGuard } from '@/common/guards/auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';

@ApiTags('PM Dashboard')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller({ path: 'pm-dashboard', version: '1' })
export class PmDashboardController {
  constructor(
    private readonly pmDashboardService: PmDashboardService,
    private readonly metricsService: MetricsService,
  ) {}

  @Get('tickets/search')
  @Roles('PM', 'MANAGER', 'ADMIN')
  @ApiOperation({ summary: 'Search tickets across projects' })
  @ApiResponse({ status: 200, description: 'Return matching tickets' })
  async searchTickets(
    @Request() req: { user: { sub: string; role: UserRole } },
    @Query() query: TicketSearchQueryDto,
  ) {
    const userId = req.user.sub;
    const role = req.user.role;
    this.metricsService.incrementCounter('pm_dashboard_api_calls_total', {
      endpoint: 'search',
      role,
    });
    return this.pmDashboardService.searchTickets(userId, role, query);
  }

  @Get('projects')
  @Roles('PM', 'MANAGER', 'ADMIN')
  @ApiOperation({ summary: 'Get all projects for the PM dashboard' })
  @ApiResponse({ status: 200, description: 'Return projects with ticket counts' })
  async getProjects(
    @Request() req: { user: { sub: string; role: UserRole } },
    @Query() query: ProjectQueryDto,
  ) {
    const userId = req.user.sub;
    const role = req.user.role;
    this.metricsService.incrementCounter('pm_dashboard_api_calls_total', {
      endpoint: 'projects',
      role,
    });
    return this.pmDashboardService.getProjects(userId, role, query);
  }

  @Get('summary')
  @Roles('PM', 'MANAGER', 'ADMIN')
  @ApiOperation({ summary: 'Get aggregate stats for PM dashboard' })
  @ApiResponse({ status: 200, description: 'Return dashboard summary statistics' })
  async getSummary(@Request() req: { user: { sub: string; role: UserRole } }) {
    const userId = req.user.sub;
    const role = req.user.role;
    this.metricsService.incrementCounter('pm_dashboard_api_calls_total', {
      endpoint: 'summary',
      role,
    });
    return this.pmDashboardService.getSummary(userId, role);
  }
}
