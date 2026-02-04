/**
 * Production Error Dashboard Service
 * Story 9-U-5: Production Error Dashboard
 *
 * Business logic for dashboard metrics, filtering, and aggregations.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import type { Prisma } from '@/prisma/client';
import { ErrorSeverity } from '@/prisma/enums';
import {
  ErrorOverviewDto,
  ErrorListResponseDto,
  ErrorListFiltersDto,
  ErrorListItemDto,
} from './dto/error-overview.dto';
import { ErrorTrendResponseDto } from './dto/error-trend.dto';
import {
  ApplicationHealthDto,
  ApplicationHealthResponseDto,
  HealthStatus,
} from './dto/application-health.dto';
import { BulkCreateTicketsResponseDto } from './dto/bulk-create-tickets.dto';
import { FixTicketService } from './fix-ticket.service';

@Injectable()
export class ProductionErrorDashboardService {
  private readonly logger = new Logger(ProductionErrorDashboardService.name);

  /**
   * ProductionErrorDashboardService
   *
   * Dependencies:
   * - PrismaService: Database access for production error queries
   * - FixTicketService: Used in bulkCreateTickets() for ticket creation logic
   *   (Story 9-U-3: Automatic ClickUp Ticket Creation)
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly fixTicketService: FixTicketService,
  ) {}

  /**
   * Get error overview metrics for the dashboard widget
   * AC#1: Error Overview Widget
   */
  async getErrorOverview(): Promise<ErrorOverviewDto> {
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Get total active errors (not resolved)
    const totalActiveErrors = await this.prisma.productionError.count({
      where: { resolved: false },
    });

    // Get new errors in last 24h
    const newErrors24h = await this.prisma.productionError.count({
      where: {
        created_at: { gte: twentyFourHoursAgo },
      },
    });

    // Get counts by severity
    const severityCounts = await this.prisma.productionError.groupBy({
      by: ['severity'],
      where: { resolved: false },
      _count: { severity: true },
    });

    const criticalErrors =
      severityCounts.find((s) => s.severity === ErrorSeverity.CRITICAL)?._count.severity || 0;
    const highErrors =
      severityCounts.find((s) => s.severity === ErrorSeverity.HIGH)?._count.severity || 0;
    const mediumErrors =
      severityCounts.find((s) => s.severity === ErrorSeverity.MEDIUM)?._count.severity || 0;
    const lowErrors =
      severityCounts.find((s) => s.severity === ErrorSeverity.LOW)?._count.severity || 0;

    // Calculate MTTR (Mean Time To Resolution)
    const mttrHours = await this.calculateMTTR();

    return {
      totalActiveErrors,
      newErrors24h,
      criticalErrors,
      highErrors,
      mediumErrors,
      lowErrors,
      mttrHours,
    };
  }

  /**
   * Calculate Mean Time To Resolution (MTTR) in hours
   * Uses resolved_at field to calculate average time from creation to resolution
   */
  private async calculateMTTR(): Promise<number | undefined> {
    try {
      // Get resolved errors with resolved_at timestamp
      const resolvedErrors = await this.prisma.productionError.findMany({
        where: {
          resolved: true,
          resolved_at: { not: null },
        },
        select: {
          created_at: true,
          resolved_at: true,
        },
        take: 1000, // Limit to last 1000 resolved errors for performance
        orderBy: {
          resolved_at: 'desc',
        },
      });

      if (resolvedErrors.length === 0) {
        this.logger.debug('No resolved errors found for MTTR calculation');
        return undefined;
      }

      // Calculate total resolution time in milliseconds
      const totalMilliseconds = resolvedErrors.reduce((sum, error) => {
        const resolutionTime = error.resolved_at!.getTime() - error.created_at.getTime();
        return sum + resolutionTime;
      }, 0);

      // Convert to hours and return average
      const averageHours = totalMilliseconds / (1000 * 60 * 60 * resolvedErrors.length);
      this.logger.debug(
        `MTTR calculated: ${averageHours.toFixed(1)}h from ${resolvedErrors.length} resolved errors`,
      );
      return Math.round(averageHours * 10) / 10; // Round to 1 decimal place
    } catch (error) {
      this.logger.warn('Failed to calculate MTTR:', error);
      return undefined;
    }
  }

  /**
   * Get filtered error list with pagination
   * AC#2: Error List Table with Filtering
   */
  async getErrorList(filters: ErrorListFiltersDto): Promise<ErrorListResponseDto> {
    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const skip = (page - 1) * limit;

    // Build where clause based on filters
    const where = this.buildWhereClause(filters);

    // Get total count
    const total = await this.prisma.productionError.count({ where });

    // Build order by
    const orderBy = this.buildOrderBy(filters);

    // Get errors
    const errors = await this.prisma.productionError.findMany({
      where,
      orderBy,
      skip,
      take: limit,
      select: {
        id: true,
        application: true,
        error_type: true,
        error_message: true,
        severity: true,
        occurred_at: true,
        affected_users: true,
        occurrence_count: true,
        fix_ticket_id: true,
        fix_ticket_url: true,
        resolved: true,
        acknowledged_at: true,
        acknowledged_by: true,
      },
    });

    return {
      errors: errors.map((e) => this.mapToErrorListItem(e)),
      total,
      page,
      limit,
    };
  }

  /**
   * Build Prisma where clause from filters
   */
  private buildWhereClause(filters: ErrorListFiltersDto): Prisma.ProductionErrorWhereInput {
    const where: Prisma.ProductionErrorWhereInput = {};

    if (filters.severity && filters.severity.length > 0) {
      where.severity = { in: filters.severity };
    }

    if (filters.application && filters.application.length > 0) {
      where.application = { in: filters.application };
    }

    if (filters.status) {
      switch (filters.status) {
        case 'active':
          where.fix_ticket_id = null;
          where.resolved = false;
          break;
        case 'ticket_created':
          where.fix_ticket_id = { not: null };
          where.resolved = false;
          break;
        case 'in_progress':
          // TODO: Add in_progress field to schema
          where.fix_ticket_id = { not: null };
          where.resolved = false;
          break;
        case 'resolved':
          where.resolved = true;
          break;
      }
    }

    if (filters.dateFrom || filters.dateTo) {
      where.occurred_at = {};
      if (filters.dateFrom) {
        where.occurred_at.gte = filters.dateFrom;
      }
      if (filters.dateTo) {
        where.occurred_at.lte = filters.dateTo;
      }
    }

    return where;
  }

  /**
   * Build Prisma order by from sort parameters
   */
  private buildOrderBy(
    filters: ErrorListFiltersDto,
  ): Prisma.ProductionErrorOrderByWithRelationInput {
    const sortBy = filters.sortBy || 'severity';
    const sortOrder = filters.sortOrder || 'desc';

    // Map severity to numeric value for proper sorting
    if (sortBy === 'severity') {
      return {
        severity: sortOrder,
      };
    }

    return {
      [sortBy]: sortOrder,
    };
  }

  /**
   * Map Prisma error to DTO
   */
  private mapToErrorListItem(error: {
    id: string;
    application: string;
    error_type: string;
    error_message: string;
    severity: ErrorSeverity;
    occurred_at: Date;
    affected_users: number;
    occurrence_count: number;
    fix_ticket_id: string | null;
    fix_ticket_url: string | null;
    resolved: boolean;
    acknowledged_at: Date | null;
    acknowledged_by: string | null;
  }): ErrorListItemDto {
    // Truncate message for list view
    const truncatedMessage =
      error.error_message.length > 100
        ? error.error_message.substring(0, 100) + '...'
        : error.error_message;

    return {
      id: error.id,
      application: error.application,
      error_type: error.error_type,
      error_message: truncatedMessage,
      severity: error.severity,
      occurred_at: error.occurred_at,
      affected_users: error.affected_users,
      occurrence_count: error.occurrence_count,
      fix_ticket_id: error.fix_ticket_id || undefined,
      fix_ticket_url: error.fix_ticket_url || undefined,
      resolved: error.resolved,
      acknowledged_at: error.acknowledged_at || undefined,
      acknowledged_by: error.acknowledged_by || undefined,
    };
  }

  /**
   * Get error trends for the 7-day chart
   * AC#5: Error Trend Chart
   */
  async getErrorTrends(days: number = 7): Promise<ErrorTrendResponseDto> {
    const now = new Date();
    const dates: string[] = [];
    const trendsBySeverity = {
      CRITICAL: [] as number[],
      HIGH: [] as number[],
      MEDIUM: [] as number[],
      LOW: [] as number[],
    };

    // Generate date range
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);
      dates.push(date.toISOString().split('T')[0]);
    }

    // Get counts for each day and severity
    for (const dateStr of dates) {
      const date = new Date(dateStr);
      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);

      const dayCounts = await this.prisma.productionError.groupBy({
        by: ['severity'],
        where: {
          occurred_at: {
            gte: date,
            lt: nextDate,
          },
        },
        _count: { severity: true },
      });

      trendsBySeverity.CRITICAL.push(
        dayCounts.find((c) => c.severity === ErrorSeverity.CRITICAL)?._count.severity || 0,
      );
      trendsBySeverity.HIGH.push(
        dayCounts.find((c) => c.severity === ErrorSeverity.HIGH)?._count.severity || 0,
      );
      trendsBySeverity.MEDIUM.push(
        dayCounts.find((c) => c.severity === ErrorSeverity.MEDIUM)?._count.severity || 0,
      );
      trendsBySeverity.LOW.push(
        dayCounts.find((c) => c.severity === ErrorSeverity.LOW)?._count.severity || 0,
      );
    }

    return {
      dates,
      trendsBySeverity,
    };
  }

  /**
   * Get application health heatmap data
   * AC#6: Application Health Heatmap
   */
  async getApplicationHealth(): Promise<ApplicationHealthResponseDto> {
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Get all applications with errors in last 24h
    const applications = await this.prisma.productionError.groupBy({
      by: ['application'],
      where: {
        occurred_at: { gte: twentyFourHoursAgo },
      },
      _count: { application: true },
    });

    // For each application, get severity breakdown and last error
    const healthData: ApplicationHealthDto[] = await Promise.all(
      applications.map(async (app) => {
        const severityCounts = await this.prisma.productionError.groupBy({
          by: ['severity'],
          where: {
            application: app.application,
            occurred_at: { gte: twentyFourHoursAgo },
          },
          _count: { severity: true },
        });

        const lastError = await this.prisma.productionError.findFirst({
          where: { application: app.application },
          orderBy: { occurred_at: 'desc' },
          select: { occurred_at: true },
        });

        const criticalCount =
          severityCounts.find((c) => c.severity === ErrorSeverity.CRITICAL)?._count.severity || 0;
        const highCount =
          severityCounts.find((c) => c.severity === ErrorSeverity.HIGH)?._count.severity || 0;
        const mediumCount =
          severityCounts.find((c) => c.severity === ErrorSeverity.MEDIUM)?._count.severity || 0;
        const lowCount =
          severityCounts.find((c) => c.severity === ErrorSeverity.LOW)?._count.severity || 0;

        const healthStatus = this.calculateHealthStatus({
          critical: criticalCount,
          high: highCount,
          medium: mediumCount,
          low: lowCount,
        });

        return {
          application: app.application,
          errorCount24h: app._count.application,
          criticalCount,
          highCount,
          mediumCount,
          lowCount,
          healthStatus,
          lastErrorAt: lastError?.occurred_at,
        };
      }),
    );

    return { applications: healthData };
  }

  /**
   * Calculate health status based on error counts
   */
  private calculateHealthStatus(errorCounts: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  }): HealthStatus {
    if (errorCounts.critical > 0) return HealthStatus.RED;
    if (errorCounts.high > 0) return HealthStatus.ORANGE;
    if (errorCounts.medium + errorCounts.low >= 6) return HealthStatus.ORANGE;
    if (errorCounts.medium + errorCounts.low >= 1) return HealthStatus.YELLOW;
    return HealthStatus.GREEN;
  }

  /**
   * Bulk create fix tickets for selected errors
   * AC#7: Quick Actions & Bulk Operations
   */
  async bulkCreateTickets(errorIds: string[]): Promise<BulkCreateTicketsResponseDto> {
    const result: BulkCreateTicketsResponseDto = {
      created: 0,
      skipped: 0,
      errors: [],
    };

    for (const errorId of errorIds) {
      try {
        // Check if error exists and doesn't already have a ticket
        const error = await this.prisma.productionError.findUnique({
          where: { id: errorId },
          select: { fix_ticket_id: true },
        });

        if (!error) {
          result.errors.push(`Error ${errorId} not found`);
          continue;
        }

        if (error.fix_ticket_id) {
          result.skipped++;
          continue;
        }

        // Create ticket via FixTicketService
        await this.fixTicketService.processError(errorId, 'bulk-create', undefined);
        result.created++;
      } catch (error) {
        this.logger.error(`Failed to create ticket for error ${errorId}:`, error);
        result.errors.push(
          `Failed to create ticket for error ${errorId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
      }
    }

    return result;
  }

  /**
   * Mark an error as acknowledged
   * AC#7: Quick Actions & Bulk Operations
   */
  async acknowledgeError(errorId: string, acknowledgedBy?: string): Promise<void> {
    await this.prisma.productionError.update({
      where: { id: errorId },
      data: {
        acknowledged_at: new Date(),
        acknowledged_by: acknowledgedBy || 'system',
      },
    });
  }

  /**
   * Get all unique application names for filter dropdown
   */
  async getApplications(): Promise<string[]> {
    const apps = await this.prisma.productionError.groupBy({
      by: ['application'],
      orderBy: { application: 'asc' },
    });

    return apps.map((a) => a.application);
  }

  /**
   * Export errors to CSV format
   * AC#7: Quick Actions & Bulk Operations
   */
  async exportErrors(errorIds?: string[]): Promise<
    Array<{
      id: string;
      application: string;
      error_type: string;
      error_message: string;
      severity: string;
      occurred_at: Date;
      affected_users: number;
      fix_ticket_url: string | null;
      resolved: boolean;
      acknowledged_at: Date | null;
      acknowledged_by: string | null;
    }>
  > {
    const where: Prisma.ProductionErrorWhereInput = {};

    if (errorIds && errorIds.length > 0) {
      where.id = { in: errorIds };
    }

    return this.prisma.productionError.findMany({
      where,
      orderBy: { occurred_at: 'desc' },
      select: {
        id: true,
        application: true,
        error_type: true,
        error_message: true,
        severity: true,
        occurred_at: true,
        affected_users: true,
        fix_ticket_url: true,
        resolved: true,
        acknowledged_at: true,
        acknowledged_by: true,
      },
    });
  }
}
