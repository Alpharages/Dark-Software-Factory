import { Transport } from '@nestjs/microservices';

export interface RabbitMQConfig {
  transport: Transport.RMQ;
  options: {
    urls: string[];
    queue: string;
    queueOptions: {
      durable: boolean;
      deadLetterExchange?: string;
      deadLetterRoutingKey?: string;
      messageTtl?: number;
    };
    prefetchCount?: number;
    noAck?: boolean;
  };
}

/**
 * Base RabbitMQ configuration
 * All queues inherit from this config
 */
export const createQueueConfig = (queueName: string, url: string): RabbitMQConfig => ({
  transport: Transport.RMQ,
  options: {
    urls: [url],
    queue: queueName,
    queueOptions: {
      durable: true, // Persist queue across RabbitMQ restarts
      deadLetterExchange: 'dlx-exchange', // Route failed messages
      deadLetterRoutingKey: `dlx-${queueName}`,
      messageTtl: 3600000, // 1 hour (messages expire if not processed)
    },
    prefetchCount: 1, // Process one message at a time per worker
    noAck: false, // Manual acknowledgment required
  },
});

/**
 * Queue names (must match architecture naming convention)
 */
export const QUEUE_NAMES = {
  // Story 2.1-2.2: Ticket intake pipeline
  TICKET_INTAKE: 'ticket-intake-queue',
  AI_ROUTING: 'ai-routing-queue',
  // Core execution queues
  AI_EXECUTION: 'ai-execution-queue',
  QA_CHECK: 'qa-check-queue',
  DEPLOYMENT: 'deployment-queue',
  MONITORING: 'monitoring-queue',
  DEAD_LETTER: 'dead-letter-queue',
} as const;

/**
 * Exchange names
 */
export const EXCHANGE_NAMES = {
  ORCHESTRATOR_EVENTS: 'orchestrator-events',
  DEAD_LETTER_EXCHANGE: 'dlx-exchange',
} as const;

/**
 * Routing keys (dot notation per architecture)
 */
export const ROUTING_KEYS = {
  // AI Execution
  AI_EXECUTION_STARTED: 'ai.execution.started',
  AI_EXECUTION_COMPLETED: 'ai.execution.completed',
  AI_EXECUTION_FAILED: 'ai.execution.failed',

  // QA Check
  QA_CHECK_STARTED: 'qa.check.started',
  QA_CHECK_COMPLETED: 'qa.check.completed',
  QA_CHECK_FAILED: 'qa.check.failed',

  // Deployment
  DEPLOYMENT_TRIGGERED: 'deployment.triggered',
  DEPLOYMENT_COMPLETED: 'deployment.completed',
  DEPLOYMENT_FAILED: 'deployment.failed',

  // Monitoring
  PRODUCTION_ERROR_DETECTED: 'monitoring.error.detected',
  PRODUCTION_ERROR_RESOLVED: 'monitoring.error.resolved',
} as const;
