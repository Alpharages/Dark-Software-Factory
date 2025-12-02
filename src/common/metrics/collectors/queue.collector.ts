import { Injectable } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter, Gauge } from 'prom-client';
import { QUEUE_METRICS, WEBSOCKET_METRICS, LABELS } from '../metrics.constants';
import { QueueMetricData, WebSocketMetricData } from '../metrics.interface';

@Injectable()
export class QueueCollector {
  constructor(
    // Queue Metrics
    @InjectMetric(QUEUE_METRICS.DEPTH)
    private readonly queueDepth: Gauge,

    @InjectMetric(QUEUE_METRICS.PROCESSING_RATE)
    private readonly queueProcessingRate: Gauge,

    @InjectMetric(QUEUE_METRICS.OLDEST_MESSAGE_AGE)
    private readonly queueOldestMessageAge: Gauge,

    @InjectMetric(QUEUE_METRICS.DEAD_LETTER_COUNT)
    private readonly queueDeadLetterCount: Gauge,

    @InjectMetric(QUEUE_METRICS.CONSUMER_COUNT)
    private readonly queueConsumerCount: Gauge,

    // WebSocket Metrics
    @InjectMetric(WEBSOCKET_METRICS.CONNECTIONS_ACTIVE)
    private readonly websocketConnectionsActive: Gauge,

    @InjectMetric(WEBSOCKET_METRICS.MESSAGES_TOTAL)
    private readonly websocketMessagesTotal: Counter,

    @InjectMetric(WEBSOCKET_METRICS.ROOMS_ACTIVE)
    private readonly websocketRoomsActive: Gauge,
  ) {}

  // ============= RabbitMQ Queue Metrics =============

  updateQueueMetrics(data: QueueMetricData): void {
    const labels = { [LABELS.QUEUE]: data.queueName };

    this.queueDepth.set(labels, data.depth);
    this.queueProcessingRate.set(labels, data.processingRate);
    this.queueConsumerCount.set(labels, data.consumerCount);

    if (data.oldestMessageAge !== undefined) {
      this.queueOldestMessageAge.set(labels, data.oldestMessageAge);
    }
    if (data.deadLetterCount !== undefined) {
      this.queueDeadLetterCount.set(labels, data.deadLetterCount);
    }
  }

  // ============= WebSocket Metrics =============

  updateWebSocketMetrics(data: WebSocketMetricData): void {
    this.websocketConnectionsActive.set(data.activeConnections);
    this.websocketRoomsActive.set(data.roomsActive);
  }

  incrementWebSocketMessages(direction: 'in' | 'out'): void {
    this.websocketMessagesTotal.inc({ [LABELS.DIRECTION]: direction });
  }
}
