/**
 * Prometheus Metrics Constants
 * Per architecture.md "Observability" section (NFR-O5)
 */

export const METRICS_CONSTANTS = {
  PREFIX: 'dsf_', // Dark Software Factory prefix
  DEFAULT_BUCKETS: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10] as number[],
  COST_BUCKETS: [0.01, 0.05, 0.1, 0.5, 1, 5, 10, 50, 100, 500] as number[],
} as const;

// HTTP Metrics
export const HTTP_METRICS = {
  REQUEST_DURATION: `${METRICS_CONSTANTS.PREFIX}http_request_duration_seconds`,
  REQUEST_TOTAL: `${METRICS_CONSTANTS.PREFIX}http_requests_total`,
  REQUEST_SIZE: `${METRICS_CONSTANTS.PREFIX}http_request_size_bytes`,
  RESPONSE_SIZE: `${METRICS_CONSTANTS.PREFIX}http_response_size_bytes`,
} as const;

// Webhook Metrics (Story 2.1)
export const WEBHOOK_METRICS = {
  RECEIVED_TOTAL: `${METRICS_CONSTANTS.PREFIX}webhook_received_total`,
  PROCESSED_TOTAL: `${METRICS_CONSTANTS.PREFIX}webhook_processed_total`,
  PROCESSING_DURATION: `${METRICS_CONSTANTS.PREFIX}webhook_processing_duration_seconds`,
  ERRORS_TOTAL: `${METRICS_CONSTANTS.PREFIX}webhook_errors_total`,
  DUPLICATES_TOTAL: `${METRICS_CONSTANTS.PREFIX}webhook_duplicates_total`,
} as const;

// Business Metrics - Tickets
export const TICKET_METRICS = {
  RECEIVED_TOTAL: `${METRICS_CONSTANTS.PREFIX}tickets_received_total`,
  PROCESSED_TOTAL: `${METRICS_CONSTANTS.PREFIX}tickets_processed_total`,
  PROCESSING_DURATION: `${METRICS_CONSTANTS.PREFIX}ticket_processing_duration_seconds`,
  QUEUE_SIZE: `${METRICS_CONSTANTS.PREFIX}ticket_queue_size`,
} as const;

// Business Metrics - AI Executions
export const AI_METRICS = {
  EXECUTIONS_TOTAL: `${METRICS_CONSTANTS.PREFIX}ai_executions_total`,
  EXECUTION_DURATION: `${METRICS_CONSTANTS.PREFIX}ai_execution_duration_seconds`,
  TOKENS_USED: `${METRICS_CONSTANTS.PREFIX}ai_tokens_used_total`,
  PROVIDER_STATUS: `${METRICS_CONSTANTS.PREFIX}ai_provider_status`,
} as const;

// Business Metrics - QA
export const QA_METRICS = {
  CHECKS_TOTAL: `${METRICS_CONSTANTS.PREFIX}qa_checks_total`,
  CHECK_DURATION: `${METRICS_CONSTANTS.PREFIX}qa_check_duration_seconds`,
  COVERAGE_PERCENT: `${METRICS_CONSTANTS.PREFIX}qa_test_coverage_percent`,
  VULNERABILITIES: `${METRICS_CONSTANTS.PREFIX}qa_security_vulnerabilities_total`,
  // Story 3.1: Linting metrics
  LINTING_TOTAL: `${METRICS_CONSTANTS.PREFIX}qa_linting_total`,
  LINTING_DURATION: `${METRICS_CONSTANTS.PREFIX}qa_linting_duration_seconds`,
  LINTING_ISSUES: `${METRICS_CONSTANTS.PREFIX}qa_linting_issues`,
  // Story 3.2: Test execution metrics
  TEST_EXECUTIONS_TOTAL: `${METRICS_CONSTANTS.PREFIX}qa_test_executions_total`,
  TEST_DURATION: `${METRICS_CONSTANTS.PREFIX}qa_test_duration_seconds`,
  TEST_PASSED_TOTAL: `${METRICS_CONSTANTS.PREFIX}qa_tests_passed_total`,
  TEST_FAILED_TOTAL: `${METRICS_CONSTANTS.PREFIX}qa_tests_failed_total`,
  // Story 3.3: Coverage metrics
  COVERAGE_ANALYSIS_TOTAL: `${METRICS_CONSTANTS.PREFIX}qa_coverage_analysis_total`,
  COVERAGE_ANALYSIS_DURATION: `${METRICS_CONSTANTS.PREFIX}qa_coverage_analysis_duration_seconds`,
  COVERAGE_DELTA: `${METRICS_CONSTANTS.PREFIX}qa_coverage_delta`,
  COVERAGE_THRESHOLD_FAILURES: `${METRICS_CONSTANTS.PREFIX}qa_coverage_threshold_failures_total`,
  // Story 3.4: Security scanning metrics
  SECURITY_SCANS_TOTAL: `${METRICS_CONSTANTS.PREFIX}qa_security_scans_total`,
  SECURITY_SCAN_DURATION: `${METRICS_CONSTANTS.PREFIX}qa_security_scan_duration_seconds`,
  SECURITY_VULNERABILITIES: `${METRICS_CONSTANTS.PREFIX}qa_security_vulnerabilities_total`,
  SECURITY_SECRETS_DETECTED: `${METRICS_CONSTANTS.PREFIX}qa_security_secrets_detected_total`,
  SECURITY_COMPLEXITY_ISSUES: `${METRICS_CONSTANTS.PREFIX}qa_security_complexity_issues_total`,
  SECURITY_PATTERN_FINDINGS: `${METRICS_CONSTANTS.PREFIX}qa_security_pattern_findings_total`,
  // Story 3.5: Quality Gate metrics
  QUALITY_GATE_EVALUATIONS_TOTAL: `${METRICS_CONSTANTS.PREFIX}qa_quality_gate_evaluations_total`,
  QUALITY_GATE_DURATION: `${METRICS_CONSTANTS.PREFIX}qa_quality_gate_duration_seconds`,
  QUALITY_SCORE_HISTOGRAM: `${METRICS_CONSTANTS.PREFIX}qa_quality_score`,
} as const;

// Business Metrics - Deployments
export const DEPLOYMENT_METRICS = {
  TOTAL: `${METRICS_CONSTANTS.PREFIX}deployments_total`,
  DURATION: `${METRICS_CONSTANTS.PREFIX}deployment_duration_seconds`,
  SUCCESS_RATE: `${METRICS_CONSTANTS.PREFIX}deployment_success_rate`,
} as const;

// Business Metrics - Costs
export const COST_METRICS = {
  PER_PROJECT: `${METRICS_CONSTANTS.PREFIX}cost_per_project`,
  PER_PROVIDER: `${METRICS_CONSTANTS.PREFIX}cost_per_provider`,
  TOTAL: `${METRICS_CONSTANTS.PREFIX}cost_total`,
  BUDGET_UTILIZATION: `${METRICS_CONSTANTS.PREFIX}budget_utilization_percent`,
} as const;

// Business Metrics - PM
export const PM_METRICS = {
  UTILIZATION_PERCENT: `${METRICS_CONSTANTS.PREFIX}pm_utilization_percent`,
  TICKETS_MANAGED: `${METRICS_CONSTANTS.PREFIX}pm_tickets_managed`,
  PROJECTS_ACTIVE: `${METRICS_CONSTANTS.PREFIX}pm_projects_active`,
} as const;

// System Metrics
export const SYSTEM_METRICS = {
  MEMORY_USAGE: `${METRICS_CONSTANTS.PREFIX}memory_usage_bytes`,
  CPU_USAGE: `${METRICS_CONSTANTS.PREFIX}cpu_usage_percent`,
  ACTIVE_CONNECTIONS: `${METRICS_CONSTANTS.PREFIX}active_connections`,
  UPTIME: `${METRICS_CONSTANTS.PREFIX}uptime_seconds`,
  EVENT_LOOP_LAG: `${METRICS_CONSTANTS.PREFIX}nodejs_event_loop_lag_seconds`,
} as const;

// RabbitMQ Queue Metrics (FR101 - Queue depth monitoring)
export const QUEUE_METRICS = {
  DEPTH: `${METRICS_CONSTANTS.PREFIX}queue_depth`,
  PROCESSING_RATE: `${METRICS_CONSTANTS.PREFIX}queue_processing_rate`,
  OLDEST_MESSAGE_AGE: `${METRICS_CONSTANTS.PREFIX}queue_oldest_message_age_seconds`,
  DEAD_LETTER_COUNT: `${METRICS_CONSTANTS.PREFIX}queue_dead_letter_count`,
  CONSUMER_COUNT: `${METRICS_CONSTANTS.PREFIX}queue_consumer_count`,
} as const;

// Database Metrics
export const DATABASE_METRICS = {
  CONNECTIONS: `${METRICS_CONSTANTS.PREFIX}database_connections`,
  QUERY_DURATION: `${METRICS_CONSTANTS.PREFIX}database_query_duration_seconds`,
  POOL_SIZE: `${METRICS_CONSTANTS.PREFIX}database_pool_size`,
} as const;

// WebSocket Metrics (Socket.IO for real-time features)
export const WEBSOCKET_METRICS = {
  CONNECTIONS_ACTIVE: `${METRICS_CONSTANTS.PREFIX}websocket_connections_active`,
  MESSAGES_TOTAL: `${METRICS_CONSTANTS.PREFIX}websocket_messages_total`,
  ROOMS_ACTIVE: `${METRICS_CONSTANTS.PREFIX}websocket_rooms_active`,
} as const;

// Error Metrics (NFR-O6 - Critical failure alerts)
export const ERROR_METRICS = {
  TOTAL: `${METRICS_CONSTANTS.PREFIX}errors_total`,
  UNHANDLED_EXCEPTIONS: `${METRICS_CONSTANTS.PREFIX}unhandled_exceptions_total`,
} as const;

// CI/CD Metrics
export const CICD_METRICS = {
  PIPELINE_TRIGGERS: `${METRICS_CONSTANTS.PREFIX}cicd_pipeline_triggers_total`,
  PIPELINE_DURATION: `${METRICS_CONSTANTS.PREFIX}cicd_pipeline_duration_seconds`,
} as const;

// Alert Thresholds Configuration (NFR-O6, NFR-O7, NFR-O8)
export const ALERT_THRESHOLDS = {
  QUEUE_DEPTH_WARNING: 50,
  QUEUE_DEPTH_CRITICAL: 100,
  PM_UTILIZATION_WARNING: 80,
  PM_UTILIZATION_CRITICAL: 95,
  COST_BUDGET_WARNING: 80, // percentage
  COST_BUDGET_CRITICAL: 100,
  ERROR_RATE_WARNING: 0.01, // 1%
  ERROR_RATE_CRITICAL: 0.05, // 5%
} as const;

// Queue Names (must match RabbitMQ configuration from Story 1.5)
export const QUEUE_NAMES = [
  'ai-execution-queue',
  'qa-check-queue',
  'deployment-queue',
  'monitoring-queue',
] as const;
export type QueueName = (typeof QUEUE_NAMES)[number];

// Common Labels
export const LABELS = {
  PROJECT: 'project_id',
  PROVIDER: 'provider',
  STATUS: 'status',
  METHOD: 'method',
  PATH: 'path',
  STATUS_CODE: 'status_code',
  CHECK_TYPE: 'check_type',
  SEVERITY: 'severity',
  PM_ID: 'pm_id',
  ENVIRONMENT: 'environment',
  QUEUE: 'queue', // For RabbitMQ queue metrics
  ERROR_TYPE: 'error_type', // For error classification
  CONNECTION_STATE: 'state', // For database/websocket connections
  DIRECTION: 'direction', // For websocket messages (in/out)
} as const;

// Provider names
export const AI_PROVIDERS = ['cursor', 'claude_code', 'fallback'] as const;
export type AIProvider = (typeof AI_PROVIDERS)[number];

// QA Check types
export const QA_CHECK_TYPES = ['linting', 'testing', 'security', 'coverage'] as const;
export type QACheckType = (typeof QA_CHECK_TYPES)[number];

// Status values
export const STATUS_VALUES = ['success', 'failed', 'pending', 'timeout'] as const;
export type StatusValue = (typeof STATUS_VALUES)[number];
