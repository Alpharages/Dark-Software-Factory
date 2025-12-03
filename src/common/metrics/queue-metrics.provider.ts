import {
  makeCounterProvider,
  makeGaugeProvider,
  makeHistogramProvider,
} from '@willsoto/nestjs-prometheus';

/**
 * Queue Metrics Providers
 * Story 2.10: RabbitMQ AI Execution Queue Processing
 */

export const queueMetricsProviders = [
  // Publishing metrics
  makeCounterProvider({
    name: 'queue_messages_published_total',
    help: 'Total messages published to queues',
    labelNames: ['queue', 'provider', 'priority'],
  }),

  makeCounterProvider({
    name: 'queue_publish_errors_total',
    help: 'Total publish errors',
    labelNames: ['queue', 'error_type'],
  }),

  // Consumer metrics
  makeCounterProvider({
    name: 'queue_messages_consumed_total',
    help: 'Total messages consumed from queues',
    labelNames: ['queue', 'status', 'provider'],
  }),

  makeCounterProvider({
    name: 'queue_messages_failed_total',
    help: 'Total messages that failed processing',
    labelNames: ['queue', 'error_type', 'final'],
  }),

  makeHistogramProvider({
    name: 'queue_processing_duration_seconds',
    help: 'Message processing duration in seconds',
    labelNames: ['queue'],
    buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120, 300],
  }),

  // Queue state metrics
  makeGaugeProvider({
    name: 'queue_depth',
    help: 'Current number of messages in queue',
    labelNames: ['queue'],
  }),

  makeGaugeProvider({
    name: 'queue_consumer_count',
    help: 'Current number of consumers on queue',
    labelNames: ['queue'],
  }),

  // Note: execution_status_transitions_total and execution_duration_seconds
  // are defined in ExecutionModule (Story 2.5) - do NOT duplicate here
];
