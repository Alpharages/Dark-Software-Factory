import { Injectable } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter, Gauge, Histogram } from 'prom-client';
import {
  TICKET_METRICS,
  AI_METRICS,
  QA_METRICS,
  DEPLOYMENT_METRICS,
  COST_METRICS,
  PM_METRICS,
  LABELS,
} from '../metrics.constants';
import {
  AIExecutionMetricData,
  QACheckMetricData,
  DeploymentMetricData,
  CostMetricData,
  PMUtilizationData,
} from '../metrics.interface';

@Injectable()
export class BusinessCollector {
  constructor(
    // Ticket Metrics
    @InjectMetric(TICKET_METRICS.RECEIVED_TOTAL)
    private readonly ticketsReceivedTotal: Counter,

    @InjectMetric(TICKET_METRICS.PROCESSED_TOTAL)
    private readonly ticketsProcessedTotal: Counter,

    @InjectMetric(TICKET_METRICS.QUEUE_SIZE)
    private readonly ticketQueueSize: Gauge,

    // AI Execution Metrics
    @InjectMetric(AI_METRICS.EXECUTIONS_TOTAL)
    private readonly aiExecutionsTotal: Counter,

    @InjectMetric(AI_METRICS.EXECUTION_DURATION)
    private readonly aiExecutionDuration: Histogram,

    @InjectMetric(AI_METRICS.TOKENS_USED)
    private readonly aiTokensUsed: Counter,

    @InjectMetric(AI_METRICS.PROVIDER_STATUS)
    private readonly aiProviderStatus: Gauge,

    // QA Metrics
    @InjectMetric(QA_METRICS.CHECKS_TOTAL)
    private readonly qaChecksTotal: Counter,

    @InjectMetric(QA_METRICS.CHECK_DURATION)
    private readonly qaCheckDuration: Histogram,

    @InjectMetric(QA_METRICS.COVERAGE_PERCENT)
    private readonly qaCoveragePercent: Gauge,

    @InjectMetric(QA_METRICS.VULNERABILITIES)
    private readonly qaVulnerabilities: Counter,

    // Deployment Metrics
    @InjectMetric(DEPLOYMENT_METRICS.TOTAL)
    private readonly deploymentsTotal: Counter,

    @InjectMetric(DEPLOYMENT_METRICS.DURATION)
    private readonly deploymentDuration: Histogram,

    @InjectMetric(DEPLOYMENT_METRICS.SUCCESS_RATE)
    private readonly deploymentSuccessRate: Gauge,

    // Story 4.7: Rollbacks
    @InjectMetric(DEPLOYMENT_METRICS.ROLLBACKS_TOTAL)
    private readonly deploymentRollbacksTotal: Counter,

    // Cost Metrics
    @InjectMetric(COST_METRICS.PER_PROJECT)
    private readonly costPerProject: Histogram,

    @InjectMetric(COST_METRICS.TOTAL)
    private readonly costTotal: Counter,

    @InjectMetric(COST_METRICS.BUDGET_UTILIZATION)
    private readonly budgetUtilization: Gauge,

    // PM Metrics
    @InjectMetric(PM_METRICS.UTILIZATION_PERCENT)
    private readonly pmUtilizationPercent: Gauge,

    @InjectMetric(PM_METRICS.TICKETS_MANAGED)
    private readonly pmTicketsManaged: Gauge,

    @InjectMetric(PM_METRICS.PROJECTS_ACTIVE)
    private readonly pmProjectsActive: Gauge,
  ) {}

  // ============= Ticket Metrics =============

  incrementTicketsReceived(projectId?: string): void {
    const labels = projectId ? { [LABELS.PROJECT]: projectId } : {};
    this.ticketsReceivedTotal.inc(labels);
  }

  incrementTicketsProcessed(projectId?: string, status: string = 'success'): void {
    const labels: Record<string, string> = { [LABELS.STATUS]: status };
    if (projectId) labels[LABELS.PROJECT] = projectId;
    this.ticketsProcessedTotal.inc(labels);
  }

  setTicketQueueSize(size: number): void {
    this.ticketQueueSize.set(size);
  }

  // ============= AI Execution Metrics =============

  recordAIExecution(data: AIExecutionMetricData): void {
    const labels: Record<string, string> = {
      [LABELS.PROVIDER]: data.provider,
      [LABELS.STATUS]: data.status,
    };
    if (data.projectId) labels[LABELS.PROJECT] = data.projectId;

    this.aiExecutionsTotal.inc(labels);
    this.aiExecutionDuration.observe(labels, data.duration);

    if (data.tokensUsed) {
      this.aiTokensUsed.inc({ [LABELS.PROVIDER]: data.provider }, data.tokensUsed);
    }
  }

  setAIProviderStatus(provider: string, isHealthy: boolean): void {
    this.aiProviderStatus.set({ [LABELS.PROVIDER]: provider }, isHealthy ? 1 : 0);
  }

  // ============= QA Metrics =============

  recordQACheck(data: QACheckMetricData): void {
    const labels: Record<string, string> = {
      [LABELS.CHECK_TYPE]: data.checkType,
      [LABELS.STATUS]: data.status,
    };
    if (data.projectId) labels[LABELS.PROJECT] = data.projectId;
    if (data.aiProvider) labels[LABELS.PROVIDER] = data.aiProvider;

    this.qaChecksTotal.inc(labels);
    this.qaCheckDuration.observe(labels, data.duration);

    if (data.coverage !== undefined) {
      this.qaCoveragePercent.set({ [LABELS.PROJECT]: data.projectId || 'unknown' }, data.coverage);
    }
  }

  incrementVulnerabilities(severity: string, count: number = 1, projectId?: string): void {
    const labels: Record<string, string> = { [LABELS.SEVERITY]: severity };
    if (projectId) labels[LABELS.PROJECT] = projectId;
    this.qaVulnerabilities.inc(labels, count);
  }

  // ============= Deployment Metrics =============

  recordDeployment(data: DeploymentMetricData): void {
    const labels: Record<string, string> = {
      [LABELS.ENVIRONMENT]: data.environment,
      [LABELS.STATUS]: data.status,
    };
    if (data.projectId) labels[LABELS.PROJECT] = data.projectId;

    this.deploymentsTotal.inc(labels);
    this.deploymentDuration.observe(labels, data.duration);
  }

  setDeploymentSuccessRate(environment: string, rate: number): void {
    this.deploymentSuccessRate.set({ [LABELS.ENVIRONMENT]: environment }, rate);
  }

  incrementDeploymentRollback(environment: string): void {
    this.deploymentRollbacksTotal.inc({ [LABELS.ENVIRONMENT]: environment });
  }

  // ============= Cost Metrics =============

  recordCost(data: CostMetricData): void {
    const labels: Record<string, string> = { [LABELS.PROVIDER]: data.provider };
    if (data.projectId) labels[LABELS.PROJECT] = data.projectId;

    this.costPerProject.observe(labels, data.amount);
    this.costTotal.inc(labels, data.amount);
  }

  setBudgetUtilization(projectId: string, utilizationPercent: number): void {
    this.budgetUtilization.set({ [LABELS.PROJECT]: projectId }, utilizationPercent);
  }

  // ============= PM Metrics =============

  updatePMUtilization(data: PMUtilizationData): void {
    const labels = { [LABELS.PM_ID]: data.pmId };

    this.pmUtilizationPercent.set(labels, data.utilizationPercent);
    this.pmTicketsManaged.set(labels, data.ticketsManaged);
    this.pmProjectsActive.set(labels, data.projectsActive);
  }
}
