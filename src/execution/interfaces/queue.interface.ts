/**
 * Queue Interfaces
 * Story 2.10: RabbitMQ AI Execution Queue Processing
 */

import { AIProvider } from '@/prisma/client';

/**
 * Message published to ai-execution-queue
 */
export interface IAIExecutionMessage {
  /** Unique message identifier */
  messageId: string;

  /** ISO 8601 timestamp */
  timestamp: string;

  /** Correlation ID for request tracing */
  correlationId: string;

  /** Message payload */
  payload: IAIExecutionPayload;
}

/**
 * AI Execution payload - core execution data
 */
export interface IAIExecutionPayload {
  /** Ticket ID from ClickUp */
  ticketId: string;

  /** Unique execution ID */
  executionId: string;

  /** Selected AI provider */
  aiProvider: AIProvider;

  /** Execution priority (1=highest, 5=lowest) */
  priority: number;

  /** AI prompt for code generation */
  prompt: string;

  /** Repository URL for code context */
  repositoryUrl: string;

  /** Project ID for context */
  projectId: string;

  /** Optional: Target branch */
  targetBranch?: string;

  /** Optional: Specific files to modify */
  targetFiles?: string[];

  /** Optional: Allow provider fallback */
  allowFallback?: boolean;

  /** Complexity score (0-10) for sandbox resource profile selection */
  complexityScore?: number;
}

/**
 * Consumer processing result
 */
export interface IProcessingResult {
  /** Whether processing succeeded */
  success: boolean;

  /** Execution ID that was processed */
  executionId: string;

  /** Duration in milliseconds */
  durationMs: number;

  /** Error message if failed */
  errorMessage?: string;

  /** Error code if failed */
  errorCode?: string;

  /** Provider that executed the task */
  executedBy?: AIProvider;
}

/**
 * Queue statistics for monitoring
 */
export interface IQueueStats {
  /** Queue name */
  queueName: string;

  /** Messages waiting in queue */
  messageCount: number;

  /** Active consumers */
  consumerCount: number;

  /** Messages processed per second */
  processingRate: number;

  /** Average processing time (ms) */
  avgProcessingTimeMs: number;
}

/**
 * Consumer state for health checks
 */
export interface IConsumerState {
  /** Consumer tag identifier */
  consumerTag: string;

  /** Whether consumer is active */
  isActive: boolean;

  /** When consumer started */
  startedAt: Date;

  /** Total messages processed */
  messagesProcessed: number;

  /** Total messages failed */
  messagesFailed: number;

  /** Currently processing message ID */
  currentMessageId: string | null;
}
