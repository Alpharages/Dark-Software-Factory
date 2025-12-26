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
import { LABELS, UX_METRICS } from './metrics.constants';
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

  // ============= Story 5.5: Conversation Metrics =============

  incrementConversationCreated(): void {
    this.incrementCounter('conversation_created_total');
  }

  incrementConversationTranscription(): void {
    this.incrementCounter('conversation_transcriptions_total');
  }

  recordConversationProcessingDuration(duration: number): void {
    this.recordHistogram('conversation_transcription_duration_seconds', duration);
  }

  incrementActionItemsExtracted(count: number): void {
    this.incrementCounter('action_items_extracted_total', { count: count.toString() });
  }

  incrementTicketsCreatedFromConversations(count: number): void {
    this.incrementCounter('tickets_created_from_conversations_total', { count: count.toString() });
  }

  incrementConversationSearchQuery(): void {
    this.incrementCounter('conversation_search_queries_total');
  }

  // ============= AC#3: System Health Check =============

  /**
   * Get system health metrics for observability dashboard
   * Queries Prometheus for HTTP request duration and error rates
   */
  async getSystemHealth(): Promise<{
    http_request_duration_p95: number;
    error_rate: number;
  }> {
    // TODO: Query Prometheus metrics
    // For now, return mock data since Prometheus integration requires configuration
    return {
      http_request_duration_p95: 0.1, // 100ms P95
      error_rate: 0.01, // 1% error rate
    };
  }

  // ============= Story 5.7: UX Metrics =============

  incrementKeyboardShortcutUsage(shortcut: string): void {
    this.incrementCounter(UX_METRICS.KEYBOARD_SHORTCUT_USAGE, {
      [LABELS.SHORTCUT]: shortcut,
    });
  }

  // ============= AetherFlow Metrics =============

  incrementAetherFlowApiCall(endpoint: string, status: string): void {
    this.businessCollector.incrementAetherFlowApiCall(endpoint, status);
  }

  recordAetherFlowApiDuration(endpoint: string, duration: number): void {
    this.businessCollector.recordAetherFlowApiDuration(endpoint, duration);
  }

  incrementConversationTicketCreationSuccess(count: number): void {
    this.businessCollector.incrementConversationTicketCreationSuccess(count);
  }

  incrementConversationTicketCreationFailure(reason: string): void {
    this.businessCollector.incrementConversationTicketCreationFailure(reason);
  }
}
