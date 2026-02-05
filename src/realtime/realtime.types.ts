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
