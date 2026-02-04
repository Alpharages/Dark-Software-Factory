/**
 * Production Error Dashboard Metrics
 * Story 9-U-5: Production Error Dashboard - AC#9
 *
 * Prometheus metrics for dashboard usage tracking.
 */

import { Injectable } from '@nestjs/common';
import { Registry, Counter } from 'prom-client';
import { ErrorSeverity } from '@/prisma/enums';

@Injectable()
export class ProductionErrorDashboardMetrics {
  private readonly dashboardViewsTotal: Counter;
  private readonly detailViewsTotal: Counter;
  private readonly ticketsCreatedTotal: Counter;
  private readonly filtersUsedTotal: Counter;

  constructor(private readonly registry: Registry) {
    // Dashboard page views counter
    this.dashboardViewsTotal = new Counter({
      name: 'prod_error_dashboard_views_total',
      help: 'Total number of production error dashboard page views',
      registers: [this.registry],
    });

    // Error detail modal views counter
    this.detailViewsTotal = new Counter({
      name: 'prod_error_detail_views_total',
      help: 'Total number of error detail modal views',
      labelNames: ['severity'],
      registers: [this.registry],
    });

    // Fix tickets created counter
    this.ticketsCreatedTotal = new Counter({
      name: 'prod_error_tickets_created_total',
      help: 'Total number of fix tickets created from dashboard',
      labelNames: ['bulk_action'],
      registers: [this.registry],
    });

    // Filter usage counter
    this.filtersUsedTotal = new Counter({
      name: 'prod_error_dashboard_filters_used_total',
      help: 'Total number of times filters are applied',
      labelNames: ['filter_type'],
      registers: [this.registry],
    });
  }

  /**
   * Increment dashboard page view counter
   */
  incrementDashboardViews(): void {
    this.dashboardViewsTotal.inc();
  }

  /**
   * Increment error detail view counter
   */
  incrementDetailView(severity: ErrorSeverity): void {
    this.detailViewsTotal.inc({ severity: severity.toLowerCase() });
  }

  /**
   * Increment tickets created counter
   */
  incrementTicketsCreated(isBulk: boolean): void {
    this.ticketsCreatedTotal.inc({ bulk_action: isBulk ? 'true' : 'false' });
  }

  /**
   * Increment filter usage counter
   */
  incrementFilterUsage(filterType: string): void {
    this.filtersUsedTotal.inc({ filter_type: filterType.toLowerCase() });
  }
}
