/**
 * Realtime Event Type Definitions
 * Story 10-U-1: Socket.IO Real-Time Infrastructure
 *
 * Standard event types for real-time communication
 * Exported for use by consumer modules
 */

export interface TicketUpdatedEvent {
  ticketId: string;
  status: string;
  updatedBy: string;
  timestamp: string;
}

export interface SystemAlertEvent {
  severity: 'info' | 'warning' | 'error' | 'critical';
  message: string;
  timestamp: string;
  source?: string;
}

/**
 * User context attached to WebSocket connections
 */
export interface WsUserContext {
  userId: string;
  roles: string[];
  email: string;
}

// Execution Events - Story 10.2

export interface ExecutionStartedEvent {
  executionId: string;
  ticketId: string;
  projectId: string | null;
  aiProvider: string;
  startedAt: string;
  payload?: {
    complexityScore?: number;
    promptLength?: number;
    estimatedTokens?: number;
  };
}

export interface ExecutionProgressEvent {
  executionId: string;
  ticketId: string;
  projectId: string | null;
  currentStep: string;
  percentComplete: number; // 0-100
  lastUpdated: string;
}

export interface ExecutionCompletedEvent {
  executionId: string;
  ticketId: string;
  projectId: string | null;
  provider: string;
  status: string;
  timestamp: string;
  payload: {
    confidenceScore?: number;
    filesChanged: string[];
    durationSeconds: number;
  };
}

export interface ExecutionFailedEvent {
  executionId: string;
  ticketId: string;
  projectId: string | null;
  provider: string;
  status: string;
  timestamp: string;
  payload: {
    errorMessage: string;
    errorCode?: string;
    isRetryable: boolean;
    retryCount: number;
    maxRetries: number;
  };
}

export interface ExecutionTimeoutEvent {
  executionId: string;
  ticketId: string;
  projectId: string | null;
  provider: string;
  status: string;
  timestamp: string;
  payload: {
    errorMessage: string;
    timeoutSeconds: number;
    lastKnownProgress?: number;
  };
}

export interface ExecutionCancelledEvent {
  executionId: string;
  ticketId: string;
  projectId: string | null;
  provider: string;
  status: string;
  timestamp: string;
  payload: {
    reason: string;
    cancelledBy?: string;
  };
}

// QA Automation Events - Story 10.3

export type GateType = 'LINTING' | 'TEST' | 'COVERAGE' | 'SECURITY' | 'COMPLEXITY' | 'CUSTOM';
export type QaFailureSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface QaGateFailedEvent {
  executionId: string;
  ticketId: string;
  projectId: string | null;
  gateType: GateType;
  failureDetails:
    | LintingFailureDetails
    | TestFailureDetails
    | CoverageFailureDetails
    | SecurityFailureDetails
    | ComplexityFailureDetails
    | Record<string, unknown>;
  severity: QaFailureSeverity;
  failedAt: Date;
}

export interface QaAllGatesFailedEvent {
  executionId: string;
  ticketId: string;
  projectId: string | null;
  failedGates: Array<{
    gateType: GateType;
    failureDetails:
      | LintingFailureDetails
      | TestFailureDetails
      | CoverageFailureDetails
      | SecurityFailureDetails
      | ComplexityFailureDetails
      | Record<string, unknown>;
    severity: QaFailureSeverity;
  }>;
  summary: {
    totalFailures: number;
    criticalCount: number;
    highCount: number;
    mediumCount: number;
    lowCount: number;
  };
  failedAt: Date;
}

export interface QaGateBlockedEvent {
  executionId: string;
  ticketId: string;
  projectId: string | null;
  blockedBy: GateType[];
  canOverride: boolean;
  overrideRoles: string[];
  blockedAt: Date;
}

export interface LintingFailureDetails {
  fileCount: number;
  errorCount: number;
  warningCount: number;
  topIssues: Array<{ rule: string; count: number }>;
  sampleErrors: Array<{ file: string; line: number; message: string }>;
}

export interface TestFailureDetails {
  testSuite: string;
  totalTests: number;
  passed: number;
  failed: number;
  failedTests: Array<{ name: string; error: string }>;
  durationMs: number;
}

export interface CoverageFailureDetails {
  requiredCoverage: number;
  actualCoverage: number;
  uncoveredFiles: string[];
  coverageDiff: number;
}

export interface SecurityFailureDetails {
  scanType: string;
  vulnerabilities: Array<{
    id: string;
    severity: string;
    package: string;
    description: string;
  }>;
  severityCounts: { critical: number; high: number; medium: number; low: number };
  remediationHints: string[];
}

export interface ComplexityFailureDetails {
  filePath: string;
  functionName: string;
  actualComplexity: number;
  maxAllowed: number;
}

// Execution Log Events - Story 10-U-4

export type LogLevel = 'STDOUT' | 'STDERR' | 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';
export type ErrorType =
  | 'AI_PROVIDER_ERROR'
  | 'WORKSPACE_ERROR'
  | 'GITHUB_ERROR'
  | 'QA_ERROR'
  | 'TIMEOUT_ERROR'
  | 'SYSTEM_ERROR';

export interface ExecutionLogEvent {
  executionId: string;
  ticketId: string | null;
  projectId: string | null;
  timestamp: Date;
  level: LogLevel;
  message: string;
  source: string; // e.g., 'ai_provider_pty', 'github_push', 'qa_linter'
}

export interface ExecutionErrorEvent {
  executionId: string;
  ticketId: string | null;
  projectId: string | null;
  timestamp: Date;
  errorMessage: string;
  errorType: ErrorType;
  stackTrace: string | null;
  isRetryable: boolean;
}

export interface ExecutionAuditEvent {
  executionId: string;
  ticketId: string | null;
  projectId: string | null;
  timestamp: Date;
  auditEvent: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata: Record<string, any>;
}
