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
  AI_ROUTING_WAIT: 'ai-routing-wait-queue', // For delayed retries (Story 2.3 fix)
  // Core execution queues
  AI_EXECUTION: 'ai-execution-queue',
  QA_CHECK: 'qa-check-queue',
  DEPLOYMENT: 'deployment-queue',
  MONITORING: 'monitoring-queue',
  DEAD_LETTER: 'dead-letter-queue',
  AI_EXECUTION_RETRY: 'ai-execution-retry-queue', // Story 2.9
  GITHUB_WEBHOOK: 'github-webhook-queue', // Story 14.1
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
  // AI Routing (Story 2.3)
  AI_ROUTING_STARTED: 'ai.routing.started',
  AI_ROUTING_COMPLETED: 'ai.routing.completed',
  AI_ROUTING_NO_PROVIDER: 'ai.routing.no_provider',

  // AI Execution
  AI_EXECUTION_STARTED: 'ai.execution.started',
  AI_EXECUTION_COMPLETED: 'ai.execution.completed',
  AI_EXECUTION_FAILED: 'ai.execution.failed',

  // QA Check
  QA_CHECK_STARTED: 'qa.check.started',
  QA_CHECK_COMPLETED: 'qa.check.completed',
  QA_CHECK_FAILED: 'qa.check.failed',

  // GitHub Push (QA → GitHub workflow trigger)
  GITHUB_PUSH_TRIGGER: 'github.push.trigger',

  // Deployment
  DEPLOYMENT_TRIGGERED: 'deployment.triggered',
  DEPLOYMENT_COMPLETED: 'deployment.completed',
  DEPLOYMENT_FAILED: 'deployment.failed',

  // Monitoring
  PRODUCTION_ERROR_DETECTED: 'monitoring.error.detected',
  PRODUCTION_ERROR_RESOLVED: 'monitoring.error.resolved',

  // GitHub Webhook (Story 14.1)
  GITHUB_WEBHOOK_RECEIVED: 'github.webhook.received',
} as const;
