import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import {
  HttpMetricData,
  AIExecutionMetricData,
  QACheckMetricData,
  DeploymentMetricData,
  CostMetricData,
  PMUtilizationData,
  QueueMetricData,
  DatabaseMetricData,
  WebSocketMetricData,
} from './metrics.interface';
import { LoggerService } from '../logger';
import { HttpCollector, BusinessCollector, SystemCollector, QueueCollector } from './collectors';

@Injectable()
export class MetricsService implements OnModuleInit, OnModuleDestroy {
  constructor(
    private readonly logger: LoggerService,
    private readonly httpCollector: HttpCollector,
    private readonly businessCollector: BusinessCollector,
    private readonly systemCollector: SystemCollector,
    private readonly queueCollector: QueueCollector,
  ) {}

  onModuleInit() {
    this.logger.log('Prometheus metrics service initialized', 'MetricsService');
    // System collector handles its own init
  }

  onModuleDestroy() {
    // System collector handles its own destroy
  }

  // ============= HTTP Metrics =============

  recordHttpRequest(data: HttpMetricData): void {
    this.httpCollector.recordRequest(data);
  }

  // ============= Ticket Metrics =============

  incrementTicketsReceived(projectId?: string): void {
    this.businessCollector.incrementTicketsReceived(projectId);
  }

  incrementTicketsProcessed(projectId?: string, status: string = 'success'): void {
    this.businessCollector.incrementTicketsProcessed(projectId, status);
  }

  setTicketQueueSize(size: number): void {
    this.businessCollector.setTicketQueueSize(size);
  }

  // ============= AI Execution Metrics =============

  recordAIExecution(data: AIExecutionMetricData): void {
    this.businessCollector.recordAIExecution(data);
  }

  setAIProviderStatus(provider: string, isHealthy: boolean): void {
    this.businessCollector.setAIProviderStatus(provider, isHealthy);
  }

  // ============= QA Metrics =============

  recordQACheck(data: QACheckMetricData): void {
    this.businessCollector.recordQACheck(data);
  }

  incrementVulnerabilities(severity: string, count: number = 1, projectId?: string): void {
    this.businessCollector.incrementVulnerabilities(severity, count, projectId);
  }

  // ============= Deployment Metrics =============

  recordDeployment(data: DeploymentMetricData): void {
    this.businessCollector.recordDeployment(data);
  }

  setDeploymentSuccessRate(environment: string, rate: number): void {
    this.businessCollector.setDeploymentSuccessRate(environment, rate);
  }

  recordDeploymentRollback(environment: string): void {
    this.businessCollector.incrementDeploymentRollback(environment);
  }

  // ============= Cost Metrics =============

  recordCost(data: CostMetricData): void {
    this.businessCollector.recordCost(data);
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
    this.businessCollector.recordAICost(data);
  }

  setBudgetUtilization(projectId: string, utilizationPercent: number): void {
    this.businessCollector.setBudgetUtilization(projectId, utilizationPercent);
  }

  // ============= PM Metrics =============

  updatePMUtilization(data: PMUtilizationData): void {
    this.businessCollector.updatePMUtilization(data);
  }

  // ============= System Metrics =============

  setActiveConnections(count: number): void {
    this.systemCollector.setActiveConnections(count);
  }

  // ============= RabbitMQ Queue Metrics (FR101) =============

  updateQueueMetrics(data: QueueMetricData): void {
    this.queueCollector.updateQueueMetrics(data);
  }

  // ============= Database Metrics =============

  updateDatabaseMetrics(data: DatabaseMetricData): void {
    this.systemCollector.updateDatabaseMetrics(data);
  }

  recordDatabaseQuery(duration: number): void {
    this.systemCollector.recordDatabaseQuery(duration);
  }

  // ============= WebSocket Metrics =============

  updateWebSocketMetrics(data: WebSocketMetricData): void {
    this.queueCollector.updateWebSocketMetrics(data);
  }

  incrementWebSocketMessages(direction: 'in' | 'out'): void {
    this.queueCollector.incrementWebSocketMessages(direction);
  }

  // ============= Error Metrics (NFR-O6) =============

  incrementErrors(errorType: string, count: number = 1): void {
    this.systemCollector.incrementErrors(errorType, count);
  }

  incrementUnhandledExceptions(): void {
    this.systemCollector.incrementUnhandledExceptions();
  }

  // ============= CI/CD Metrics =============

  recordCICDPipeline(provider: string, status: string, duration?: number): void {
    this.systemCollector.recordCICDPipeline(provider, status, duration);
  }

  // ============= GitHub Metrics =============

  incrementGitHubOperation(operation: string, status: string): void {
    this.systemCollector.incrementGitHubOperation(operation, status);
  }

  incrementGitHubRateLimitHit(): void {
    this.systemCollector.incrementGitHubRateLimitHit();
  }

  // Story 4.3: GitHub commit metrics
  incrementGitHubCommitsCreated(status: string, repository: string, aiProvider: string): void {
    this.systemCollector.incrementGitHubCommitsCreated(status, repository, aiProvider);
  }

  recordGitHubOperationDuration(operation: string, duration: number, repository?: string): void {
    this.systemCollector.recordGitHubOperationDuration(operation, duration, repository);
  }

  recordGitHubCommitDuration(duration: number): void {
    this.systemCollector.recordGitHubOperationDuration('full_commit', duration);
  }

  incrementGitHubPushSuccess(repository: string, branchType?: string): void {
    this.systemCollector.incrementGitHubPushSuccess(repository, branchType);
  }

  incrementGitHubFilesPushed(fileType: string, repository?: string): void {
    this.systemCollector.incrementGitHubFilesPushed(fileType, repository);
  }

  recordGitHubCommitSize(sizeBytes: number, repository: string): void {
    this.systemCollector.recordGitHubCommitSize(sizeBytes, repository);
  }

  // Story 4.7: GitHub Error Metrics
  recordGitHubError(operation: string, errorType: string): void {
    this.systemCollector.incrementGitHubError(operation, errorType);
  }

  // ============= Generic Metrics Facade (Story 4.8) =============

  incrementCounter(name: string, labels?: Record<string, string>): void {
    if (this.systemCollector.incrementGenericCounter(name, labels)) return;
    this.businessCollector.incrementGenericCounter(name, labels);
  }

  recordHistogram(name: string, value: number, labels?: Record<string, string>): void {
    if (this.systemCollector.recordGenericHistogram(name, value, labels)) return;
    this.businessCollector.recordGenericHistogram(name, value, labels);
  }

  setGauge(name: string, value: number, labels?: Record<string, string>): void {
    if (this.systemCollector.setGenericGauge(name, value, labels)) return;
    this.businessCollector.setGenericGauge(name, value, labels);
  }

  incrementGauge(name: string, value: number = 1, labels?: Record<string, string>): void {
    if (this.systemCollector.incrementGenericGauge(name, value, labels)) return;
    this.businessCollector.incrementGenericGauge(name, value, labels);
  }

  decrementGauge(name: string, value: number = 1, labels?: Record<string, string>): void {
    if (this.systemCollector.decrementGenericGauge(name, value, labels)) return;
    this.businessCollector.decrementGenericGauge(name, value, labels);
  }
}
