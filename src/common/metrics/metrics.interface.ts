import { Histogram, Counter, Gauge, Summary } from 'prom-client';

/**
 * Metric registration options
 */
export interface MetricOptions {
  name: string;
  help: string;
  labelNames?: string[];
  buckets?: number[];
}

/**
 * Business metric increment options
 */
export interface MetricIncrementOptions {
  labels?: Record<string, string>;
  value?: number;
}

/**
 * HTTP request metric data
 */
export interface HttpMetricData {
  method: string;
  path: string;
  statusCode: number;
  duration: number;
  requestSize?: number;
  responseSize?: number;
}

/**
 * AI execution metric data
 */
export interface AIExecutionMetricData {
  provider: string;
  status: 'success' | 'failed' | 'timeout';
  duration: number;
  tokensUsed?: number;
  projectId?: string;
}

/**
 * QA check metric data
 */
export interface QACheckMetricData {
  checkType: string;
  status: 'passed' | 'failed';
  duration: number;
  projectId?: string;
  coverage?: number;
}

/**
 * Deployment metric data
 */
export interface DeploymentMetricData {
  environment: string;
  status: 'success' | 'failed' | 'rolled_back';
  duration: number;
  projectId?: string;
}

/**
 * Cost metric data
 */
export interface CostMetricData {
  provider: string;
  amount: number;
  projectId?: string;
}

/**
 * PM utilization metric data
 */
export interface PMUtilizationData {
  pmId: string;
  utilizationPercent: number;
  ticketsManaged: number;
  projectsActive: number;
}

/**
 * RabbitMQ queue metric data (FR101)
 */
export interface QueueMetricData {
  queueName: string;
  depth: number;
  processingRate: number; // messages per minute
  oldestMessageAge?: number; // seconds
  consumerCount: number;
  deadLetterCount?: number;
}

/**
 * Database connection metric data
 */
export interface DatabaseMetricData {
  activeConnections: number;
  idleConnections: number;
  waitingConnections: number;
  poolSize: number;
}

/**
 * WebSocket metric data
 */
export interface WebSocketMetricData {
  activeConnections: number;
  roomsActive: number;
}

/**
 * Error metric data
 */
export interface ErrorMetricData {
  errorType: 'validation' | 'runtime' | 'timeout' | 'integration';
  count?: number;
}

/**
 * All registered metrics container
 */
export interface RegisteredMetrics {
  // HTTP
  httpRequestDuration: Histogram;
  httpRequestTotal: Counter;

  // Tickets
  ticketsReceivedTotal: Counter;
  ticketsProcessedTotal: Counter;
  ticketQueueSize: Gauge;

  // AI
  aiExecutionsTotal: Counter;
  aiExecutionDuration: Histogram;
  aiTokensUsed: Counter;
  aiProviderStatus: Gauge;

  // QA
  qaChecksTotal: Counter;
  qaCheckDuration: Histogram;
  qaCoveragePercent: Gauge;
  qaVulnerabilities: Counter;

  // Deployments
  deploymentsTotal: Counter;
  deploymentDuration: Histogram;
  deploymentSuccessRate: Gauge;

  // Costs
  costPerProject: Histogram;
  costPerProvider: Counter;
  costTotal: Counter;
  budgetUtilization: Gauge;

  // PM
  pmUtilizationPercent: Gauge;
  pmTicketsManaged: Gauge;
  pmProjectsActive: Gauge;

  // System
  memoryUsage: Gauge;
  cpuUsage: Gauge;
  activeConnections: Gauge;
  uptime: Gauge;
}
