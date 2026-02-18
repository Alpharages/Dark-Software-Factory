/**
 * Production Error Dashboard Metrics Tests
 * Story 9-U-5: Production Error Dashboard - AC#9
 */

import { Test, TestingModule } from '@nestjs/testing';
import { Registry } from 'prom-client';
import { ProductionErrorDashboardMetrics } from './production-error-dashboard.metrics';
import { ErrorSeverity } from '@/prisma/enums';

describe('ProductionErrorDashboardMetrics', () => {
  let metrics: ProductionErrorDashboardMetrics;
  let registry: Registry;

  beforeEach(async () => {
    registry = new Registry();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductionErrorDashboardMetrics,
        { provide: 'PROMETHEUS_REGISTRY', useValue: registry },
      ],
    }).compile();

    metrics = module.get<ProductionErrorDashboardMetrics>(ProductionErrorDashboardMetrics);
  });

  afterEach(() => {
    registry.clear();
  });

  describe('incrementDashboardViews', () => {
    it('should increment dashboard views counter', async () => {
      metrics.incrementDashboardViews();
      metrics.incrementDashboardViews();

      const metric = await registry.getSingleMetric('prod_error_dashboard_views_total');
      const values = await metric?.get();
      expect(values?.values[0].value).toBe(2);
    });
  });

  describe('incrementDetailView', () => {
    it('should increment detail view counter with severity label', async () => {
      metrics.incrementDetailView(ErrorSeverity.CRITICAL);
      metrics.incrementDetailView(ErrorSeverity.HIGH);
      metrics.incrementDetailView(ErrorSeverity.CRITICAL);

      const metric = await registry.getSingleMetric('prod_error_detail_views_total');
      const values = await metric?.get();

      const criticalValue = values?.values.find((v) => v.labels.severity === 'critical');
      const highValue = values?.values.find((v) => v.labels.severity === 'high');

      expect(criticalValue?.value).toBe(2);
      expect(highValue?.value).toBe(1);
    });

    it('should handle all severity levels', async () => {
      metrics.incrementDetailView(ErrorSeverity.CRITICAL);
      metrics.incrementDetailView(ErrorSeverity.HIGH);
      metrics.incrementDetailView(ErrorSeverity.MEDIUM);
      metrics.incrementDetailView(ErrorSeverity.LOW);

      const metric = await registry.getSingleMetric('prod_error_detail_views_total');
      const values = await metric?.get();

      expect(values?.values).toHaveLength(4);
    });
  });

  describe('incrementTicketsCreated', () => {
    it('should increment tickets created counter with bulk_action label', async () => {
      metrics.incrementTicketsCreated(true);
      metrics.incrementTicketsCreated(true);
      metrics.incrementTicketsCreated(false);

      const metric = await registry.getSingleMetric('prod_error_tickets_created_total');
      const values = await metric?.get();

      const bulkValue = values?.values.find((v) => v.labels.bulk_action === 'true');
      const singleValue = values?.values.find((v) => v.labels.bulk_action === 'false');

      expect(bulkValue?.value).toBe(2);
      expect(singleValue?.value).toBe(1);
    });
  });

  describe('incrementFilterUsage', () => {
    it('should increment filter usage counter with filter_type label', async () => {
      metrics.incrementFilterUsage('severity');
      metrics.incrementFilterUsage('application');
      metrics.incrementFilterUsage('severity');

      const metric = await registry.getSingleMetric('prod_error_dashboard_filters_used_total');
      const values = await metric?.get();

      const severityValue = values?.values.find((v) => v.labels.filter_type === 'severity');
      const appValue = values?.values.find((v) => v.labels.filter_type === 'application');

      expect(severityValue?.value).toBe(2);
      expect(appValue?.value).toBe(1);
    });

    it('should convert filter type to lowercase', async () => {
      metrics.incrementFilterUsage('SEVERITY');

      const metric = await registry.getSingleMetric('prod_error_dashboard_filters_used_total');
      const values = await metric?.get();

      expect(values?.values[0].labels.filter_type).toBe('severity');
    });
  });

  describe('metric registration', () => {
    it('should register all metrics with registry', async () => {
      const metrics = await registry.metrics();

      expect(metrics).toContain('prod_error_dashboard_views_total');
      expect(metrics).toContain('prod_error_detail_views_total');
      expect(metrics).toContain('prod_error_tickets_created_total');
      expect(metrics).toContain('prod_error_dashboard_filters_used_total');
    });

    it('should have correct help text for each metric', async () => {
      const metrics = await registry.metrics();

      expect(metrics).toContain('# HELP prod_error_dashboard_views_total');
      expect(metrics).toContain('# HELP prod_error_detail_views_total');
      expect(metrics).toContain('# HELP prod_error_tickets_created_total');
      expect(metrics).toContain('# HELP prod_error_dashboard_filters_used_total');
    });
  });
});
