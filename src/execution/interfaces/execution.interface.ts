/**
 * Execution Tracking Interfaces
 * FR62: System monitors AI execution progress
 * Architecture Reference: Data Architecture - Execution model
 */

import { AIProvider, ExecutionStatus } from '@/prisma/client';

/**
 * Input for starting a new execution
 * Combines routing result + generated prompt
 */
export interface IStartExecutionInput {
  correlationId: string;
  ticketId: string;
  clickupTaskId: string;
  provider: AIProvider;
  prompt: string;
  promptMetadata: IPromptMetadataSnapshot;
  complexityScore: number;
  feedback?: string;
}

/**
 * Snapshot of prompt metadata at execution time
 */
export interface IPromptMetadataSnapshot {
  promptLength: number;
  estimatedTokens: number;
  templateVersion: string;
  generatedAt: string;
}

/**
 * Execution record with full details
 */
export interface IExecutionRecord {
  id: string;
  ticketId: string;
  provider: AIProvider;
  prompt: string;
  status: ExecutionStatus;
  confidenceScore: number | null;

  startedAt: Date | null;
  completedAt: Date | null;
  failedAt: Date | null;
  errorMessage: string | null;

  codeOutput: string | null;
  filesChanged: string[] | null;

  retryCount: number;
  maxRetries: number;

  createdAt: Date;
  updatedAt: Date;
}

/**
 * State transition event
 */
export interface IStateTransition {
  executionId: string;
  previousStatus: ExecutionStatus;
  newStatus: ExecutionStatus;
  reason?: string;
  metadata?: Record<string, unknown>;
  transitionedAt: Date;
}

/**
 * Execution completion data
 */
export interface IExecutionCompletion {
  executionId: string;
  codeOutput: string;
  filesChanged: string[];
  confidenceScore: number;
}

/**
 * Execution failure data
 */
export interface IExecutionFailure {
  executionId: string;
  errorMessage: string;
  isRetryable: boolean;
  errorCode?: string;
}

/**
 * Execution timeout data
 */
export interface IExecutionTimeout {
  executionId: string;
  timeoutSeconds: number;
  lastKnownProgress?: string;
}

/**
 * Event payload for RabbitMQ
 */
export interface IExecutionEvent {
  eventType: 'EXECUTION_STARTED' | 'STATUS_CHANGED' | 'EXECUTION_COMPLETED' | 'EXECUTION_FAILED';
  correlationId: string;
  executionId: string;
  ticketId: string;
  provider: AIProvider;
  status: ExecutionStatus;
  timestamp: string;
  payload?: Record<string, unknown>;
}

/**
 * Audit log entry for execution
 */
export interface IExecutionAuditLog {
  entityType: 'execution';
  entityId: string;
  action: 'created' | 'status_changed' | 'completed' | 'failed' | 'retried';
  actorType: 'system';
  actorId: null;
  beforeState: Record<string, unknown> | null;
  afterState: Record<string, unknown>;
  createdAt: Date;
}
