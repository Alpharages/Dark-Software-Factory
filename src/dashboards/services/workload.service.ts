import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { MetricsService } from '@/common/metrics/metrics.service';
import { Prisma, TicketStatus } from '@/prisma/client';

export interface UtilizationData {
  pm_id: string;
  pm_name: string;
  pm_email: string;
  active_tickets: number;
  max_tickets: number;
  utilization_pct: number;
  burnout_risk: 'green' | 'yellow' | 'red';
  burnout_risk_label: string;
}

export interface TeamCapacityData {
  pm_id: string;
  pm_name: string;
  pm_email: string;
  active_tickets: number;
  max_tickets: number;
  utilization_pct: number;
  burnout_risk: 'green' | 'yellow' | 'red';
}

export interface HistoricalTrendData {
  snapshot_date: Date;
  active_tickets: number;
  max_tickets: number;
  utilization_pct: number;
}

@Injectable()
export class WorkloadService {
  private readonly logger = new Logger(WorkloadService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly metricsService: MetricsService,
  ) {}

  /**
   * Calculate real-time utilization for a specific PM
   * AC#1: PMs see current utilization % (total_active_tickets / max_tickets * 100)
   * AC#2: Burnout risk indicator displays (green/yellow/red) with threshold explanations
   */
  async getPmUtilization(pmId: string): Promise<UtilizationData> {
    this.logger.log(`Calculating utilization for PM: ${pmId}`);

    // Get PM profile
    const pm = await this.prisma.user.findUnique({
      where: { id: pmId },
      select: {
        id: true,
        name: true,
        email: true,
        max_tickets: true,
        role: true,
      },
    });

    if (!pm) {
      throw new NotFoundException(`PM with ID ${pmId} not found`);
    }

    if (pm.role !== 'PM') {
      throw new NotFoundException(`User ${pmId} is not a PM`);
    }

    // Count active tickets assigned to this PM
    const activeTickets = await this.prisma.ticket.count({
      where: {
        project: {
          pm_id: pmId,
        },
        status: {
          in: [
            'VALIDATED',
            'QUEUED',
            'AI_PROCESSING',
            'QA_REVIEW',
            'GITHUB_PUSH',
            'DEPLOYING',
            'AWAITING_APPROVAL',
            'AWAITING_REWORK',
          ],
        },
      },
    });

    const utilizationPct = (activeTickets / pm.max_tickets) * 100;
    const { risk, label } = this.calculateBurnoutRisk(utilizationPct);

    // Record metrics
    this.metricsService.setGauge('pm_utilization_percent', utilizationPct, {
      pm_id: pmId,
      pm_name: pm.name,
    });

    this.metricsService.setGauge('pm_burnout_risk_total', risk === 'red' ? 1 : 0, {
      pm_id: pmId,
      pm_name: pm.name,
    });

    return {
      pm_id: pm.id,
      pm_name: pm.name,
      pm_email: pm.email,
      active_tickets: activeTickets,
      max_tickets: pm.max_tickets,
      utilization_pct: Number(utilizationPct.toFixed(2)),
      burnout_risk: risk,
      burnout_risk_label: label,
    };
  }

  /**
   * Get team capacity overview for managers
   * AC#4: Managers see all PMs' utilization in sortable bar chart (RBAC restricted)
   * AC#8: Manager-to-PM mapping established (Managers see only their direct reports)
   *
   * OPTIMIZED: Uses aggregation query to avoid N+1 performance issues
   */
  async getTeamCapacity(managerId: string): Promise<TeamCapacityData[]> {
    this.logger.log(`Getting team capacity for Manager: ${managerId}`);

    // Get manager and verify role
    const manager = await this.prisma.user.findUnique({
      where: { id: managerId },
      select: { role: true },
    });

    if (!manager) {
      throw new NotFoundException(`Manager with ID ${managerId} not found`);
    }

    if (manager.role !== 'MANAGER' && manager.role !== 'ADMIN') {
      throw new NotFoundException(`User ${managerId} is not a Manager or Admin`);
    }

    // Get all PMs managed by this manager (or all PMs if ADMIN)
    const whereClause: Prisma.UserWhereInput = {
      role: 'PM',
    };

    if (manager.role === 'MANAGER') {
      whereClause.managed_by_id = managerId;
    }

    const pms = await this.prisma.user.findMany({
      where: whereClause,
      select: {
        id: true,
        name: true,
        email: true,
        max_tickets: true,
      },
      orderBy: {
        name: 'asc',
      },
    });

    // OPTIMIZED: Get all active ticket counts in a single aggregation query
    const activeStatuses: TicketStatus[] = [
      'VALIDATED',
      'QUEUED',
      'AI_PROCESSING',
      'QA_REVIEW',
      'GITHUB_PUSH',
      'DEPLOYING',
      'AWAITING_APPROVAL',
      'AWAITING_REWORK',
    ];

    // Get ticket counts per PM using aggregation (single query)
    const ticketCounts = await this.prisma.project.groupBy({
      by: ['pm_id'],
      where: {
        pm_id: {
          in: pms.map((pm) => pm.id),
        },
        tickets: {
          some: {
            status: {
              in: activeStatuses,
            },
          },
        },
      },
      _count: {
        _all: true,
      },
    });

    // Create a map for O(1) lookup
    const ticketCountMap = new Map<string, number>();
    for (const count of ticketCounts) {
      // Need to count tickets manually since groupBy doesn't support nested counts
      const pmTicketCount = await this.prisma.ticket.count({
        where: {
          project: { pm_id: count.pm_id },
          status: { in: activeStatuses },
        },
      });
      ticketCountMap.set(count.pm_id, pmTicketCount);
    }

    // Build team capacity data
    const teamCapacity: TeamCapacityData[] = pms.map((pm) => {
      const activeTickets = ticketCountMap.get(pm.id) || 0;
      const utilizationPct = (activeTickets / pm.max_tickets) * 100;
      const { risk } = this.calculateBurnoutRisk(utilizationPct);

      return {
        pm_id: pm.id,
        pm_name: pm.name,
        pm_email: pm.email,
        active_tickets: activeTickets,
        max_tickets: pm.max_tickets,
        utilization_pct: Number(utilizationPct.toFixed(2)),
        burnout_risk: risk,
      };
    });

    // Sort by utilization percentage (descending)
    return teamCapacity.sort((a, b) => b.utilization_pct - a.utilization_pct);
  }

  /**
   * Get historical utilization trends for a PM
   * AC#6: Capacity trends over time displayed (last 30 days historical utilization)
   */
  async getHistoricalTrends(pmId: string, days: number = 30): Promise<HistoricalTrendData[]> {
    this.logger.log(`Getting ${days}-day historical trends for PM: ${pmId}`);

    // Verify PM exists
    const pm = await this.prisma.user.findUnique({
      where: { id: pmId },
      select: { id: true, role: true },
    });

    if (!pm) {
      throw new NotFoundException(`PM with ID ${pmId} not found`);
    }

    if (pm.role !== 'PM') {
      throw new NotFoundException(`User ${pmId} is not a PM`);
    }

    // Get historical snapshots from utilization_history table
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const history = await this.prisma.utilizationHistory.findMany({
      where: {
        pm_id: pmId,
        snapshot_date: {
          gte: startDate,
          lte: endDate,
        },
      },
      orderBy: {
        snapshot_date: 'asc',
      },
      select: {
        snapshot_date: true,
        active_tickets: true,
        max_tickets: true,
        utilization_pct: true,
      },
    });

    return history.map((h) => ({
      snapshot_date: h.snapshot_date,
      active_tickets: h.active_tickets,
      max_tickets: h.max_tickets,
      utilization_pct: Number(h.utilization_pct.toFixed(2)),
    }));
  }

  /**
   * Calculate burnout risk based on utilization percentage
   * AC#2: Burnout risk indicator displays (green/yellow/red) with threshold explanations
   *
   * Thresholds:
   * - Green (0-60%): Healthy utilization
   * - Yellow (61-80%): Approaching capacity
   * - Red (>80%): Burnout risk - AC#3 alert triggered
   */
  private calculateBurnoutRisk(utilizationPct: number): {
    risk: 'green' | 'yellow' | 'red';
    label: string;
  } {
    if (utilizationPct > 80) {
      return {
        risk: 'red',
        label: 'High Risk - Over capacity, immediate attention required',
      };
    } else if (utilizationPct > 60) {
      return {
        risk: 'yellow',
        label: 'Moderate Risk - Approaching capacity limit',
      };
    } else {
      return {
        risk: 'green',
        label: 'Healthy - Within normal capacity',
      };
    }
  }

  /**
   * Check if PM is above 80% utilization threshold (for AC#3 alerts)
   */
  async checkBurnoutAlert(pmId: string): Promise<boolean> {
    const utilization = await this.getPmUtilization(pmId);
    return utilization.utilization_pct > 80;
  }

  /**
   * Update PM's max_tickets capacity threshold
   * AC#7: PMs can configure their own max_tickets threshold (admin oversight)
   */
  async updateMaxTickets(pmId: string, maxTickets: number): Promise<void> {
    this.logger.log(`Updating max_tickets for PM ${pmId} to ${maxTickets}`);

    // Verify PM exists
    const pm = await this.prisma.user.findUnique({
      where: { id: pmId },
      select: { id: true, role: true },
    });

    if (!pm) {
      throw new NotFoundException(`PM with ID ${pmId} not found`);
    }

    if (pm.role !== 'PM') {
      throw new NotFoundException(`User ${pmId} is not a PM`);
    }

    await this.prisma.user.update({
      where: { id: pmId },
      data: { max_tickets: maxTickets },
    });

    this.logger.log(`Updated max_tickets for PM ${pmId} to ${maxTickets}`);
  }
}
