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
  GITHUB_METRICS,
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
  private readonly metrics: Map<string, Counter<string> | Gauge<string> | Histogram<string>> =
    new Map();

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

    @InjectMetric(AI_METRICS.TOKENS_INPUT_TOTAL)
    private readonly aiTokensInputTotal: Counter,

    @InjectMetric(AI_METRICS.TOKENS_OUTPUT_TOTAL)
    private readonly aiTokensOutputTotal: Counter,

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

    // Story 4.8: New Metrics
    @InjectMetric(DEPLOYMENT_METRICS.IN_PROGRESS)
    private readonly deploymentInProgress: Gauge,

    @InjectMetric(GITHUB_METRICS.PUSH_TOTAL)
    private readonly githubPushTotal: Counter,

    @InjectMetric(GITHUB_METRICS.PR_CREATED_TOTAL)
    private readonly githubPrCreatedTotal: Counter,

    @InjectMetric(GITHUB_METRICS.BRANCH_TOTAL)
    private readonly githubBranchTotal: Counter,

    @InjectMetric(GITHUB_METRICS.COMMIT_TOTAL)
    private readonly githubCommitTotal: Counter,

    @InjectMetric(GITHUB_METRICS.API_CALLS_TOTAL)
    private readonly githubApiCallsTotal: Counter,

    @InjectMetric(GITHUB_METRICS.PUSH_DURATION)
    private readonly githubPushDuration: Histogram,

    @InjectMetric(GITHUB_METRICS.API_CALL_DURATION)
    private readonly githubApiCallDuration: Histogram,

    @InjectMetric(GITHUB_METRICS.PR_CREATION_DURATION)
    private readonly githubPrCreationDuration: Histogram,
  ) {
    this.registerMetrics();
  }

  private registerMetrics() {
    // Register metrics for generic lookup
    this.metrics.set(GITHUB_METRICS.PUSH_TOTAL, this.githubPushTotal);
    this.metrics.set(GITHUB_METRICS.PR_CREATED_TOTAL, this.githubPrCreatedTotal);
    this.metrics.set(GITHUB_METRICS.BRANCH_TOTAL, this.githubBranchTotal);
    this.metrics.set(GITHUB_METRICS.COMMIT_TOTAL, this.githubCommitTotal);
    this.metrics.set(GITHUB_METRICS.API_CALLS_TOTAL, this.githubApiCallsTotal);
    this.metrics.set(GITHUB_METRICS.PUSH_DURATION, this.githubPushDuration);
    this.metrics.set(GITHUB_METRICS.API_CALL_DURATION, this.githubApiCallDuration);
    this.metrics.set(GITHUB_METRICS.PR_CREATION_DURATION, this.githubPrCreationDuration);
    this.metrics.set(DEPLOYMENT_METRICS.IN_PROGRESS, this.deploymentInProgress);
    this.metrics.set(DEPLOYMENT_METRICS.TOTAL, this.deploymentsTotal);
    this.metrics.set(DEPLOYMENT_METRICS.DURATION, this.deploymentDuration);
    this.metrics.set(DEPLOYMENT_METRICS.SUCCESS_RATE, this.deploymentSuccessRate);
    this.metrics.set(DEPLOYMENT_METRICS.ROLLBACKS_TOTAL, this.deploymentRollbacksTotal);
  }

  // ============= Generic Methods (Story 4.8) =============

  incrementGenericCounter(name: string, labels?: Record<string, string>): boolean {
    const metric = this.metrics.get(name);
    if (metric && 'inc' in metric) {
      (metric as Counter<string>).inc(labels || {});
      return true;
    }
    return false;
  }

  recordGenericHistogram(name: string, value: number, labels?: Record<string, string>): boolean {
    const metric = this.metrics.get(name);
    if (metric && 'observe' in metric) {
      (metric as Histogram<string>).observe(labels || {}, value);
      return true;
    }
    return false;
  }

  setGenericGauge(name: string, value: number, labels?: Record<string, string>): boolean {
    const metric = this.metrics.get(name);
    if (metric && 'set' in metric) {
      (metric as Gauge<string>).set(labels || {}, value);
      return true;
    }
    return false;
  }

  incrementGenericGauge(name: string, value: number = 1, labels?: Record<string, string>): boolean {
    const metric = this.metrics.get(name);
    if (metric && 'inc' in metric) {
      (metric as Gauge<string>).inc(labels || {}, value);
      return true;
    }
    return false;
  }

  decrementGenericGauge(name: string, value: number = 1, labels?: Record<string, string>): boolean {
    const metric = this.metrics.get(name);
    if (metric && 'dec' in metric) {
      (metric as Gauge<string>).dec(labels || {}, value);
      return true;
    }
    return false;
  }

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
      // Legacy support if needed, but we prefer split counters
      this.aiTokensInputTotal.inc({ [LABELS.PROVIDER]: data.provider }, data.tokensUsed);
    }
  }

  recordAICost(data: {
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    agentName: string;
    operationType: string;
    projectId?: string;
  }): void {
    const labels: Record<string, string> = {
      [LABELS.PROVIDER]: data.provider,
      ['model']: data.model,
      ['agent_name']: data.agentName,
      ['operation_type']: data.operationType,
    };
    if (data.projectId) labels[LABELS.PROJECT] = data.projectId;

    this.aiTokensInputTotal.inc(labels, data.inputTokens);
    this.aiTokensOutputTotal.inc(labels, data.outputTokens);
    this.costTotal.inc(labels, data.costUsd);
    this.costPerProject.observe(labels, data.costUsd);
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
