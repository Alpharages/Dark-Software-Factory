/**
 * Production Error Event Emitter Service
 * Story 9-U-5: Production Error Dashboard - AC#4
 *
 * Consumes error.stored events from RabbitMQ and emits Socket.IO events for real-time dashboard updates.
 */

import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import * as amqp from 'amqplib';
import { RabbitMQService } from '@/rabbitmq/rabbitmq.service';
import { RabbitMQConsumerBase } from '@/rabbitmq/rabbitmq-consumer.base';
import { EXCHANGE_NAMES, ROUTING_KEYS } from '@/rabbitmq/rabbitmq.config';
import { ErrorSeverity } from '@/prisma/enums';
import { RealtimeGateway } from '@/realtime/realtime.gateway';
import { PrismaService } from '@/database/prisma.service';

/** Queue name for Socket.IO event broadcasting */
const SOCKET_IO_EVENTS_QUEUE = 'production_error_socketio_events_queue';

export interface ErrorStoredEvent {
  production_error_id: string;
  application: string;
  severity: ErrorSeverity;
  occurred_at: Date;
  correlation_id?: string;
  execution_id?: string;
}

@Injectable()
export class ProductionErrorEventEmitter extends RabbitMQConsumerBase implements OnModuleInit {
  protected readonly logger = new Logger(ProductionErrorEventEmitter.name);

  constructor(
    private readonly rabbitMQService: RabbitMQService,
    private readonly realtimeGateway: RealtimeGateway,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  /**
   * Start consuming on module init
   */
  async onModuleInit(): Promise<void> {
    // Wait for RabbitMQ service to initialize
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await this.startConsuming();
  }

  /**
   * Start consuming from Socket.IO events queue
   */
  async startConsuming(): Promise<void> {
    this.logger.log(`Starting consumer for ${SOCKET_IO_EVENTS_QUEUE}`);

    try {
      const channel = this.rabbitMQService.getChannel();

      // Ensure queue exists and is bound to production-events exchange
      await channel.assertQueue(SOCKET_IO_EVENTS_QUEUE, {
        durable: true,
        arguments: {
          'x-dead-letter-exchange': EXCHANGE_NAMES.DEAD_LETTER_EXCHANGE,
          'x-dead-letter-routing-key': `dlx-${SOCKET_IO_EVENTS_QUEUE}`,
        },
      });

      await channel.bindQueue(
        SOCKET_IO_EVENTS_QUEUE,
        EXCHANGE_NAMES.PRODUCTION_EVENTS,
        ROUTING_KEYS.PRODUCTION_ERROR_STORED,
      );

      // Set prefetch for controlled concurrency
      await channel.prefetch(5);

      // Start consuming
      await channel.consume(
        SOCKET_IO_EVENTS_QUEUE,
        (message: amqp.ConsumeMessage | null) => {
          if (message) {
            this.handleMessage(message, channel);
          }
        },
        { noAck: false },
      );

      this.logger.log(`Consumer started for ${SOCKET_IO_EVENTS_QUEUE} (prefetch: 5)`);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const errorStack = err instanceof Error ? err.stack : undefined;
      this.logger.error(`Failed to start ProductionErrorEventEmitter: ${errorMsg}`, errorStack);
    }
  }

  /**
   * Process a message from the queue
   */
  protected async processMessage(payload: unknown, correlationId: string): Promise<void> {
    const event = payload as ErrorStoredEvent;

    this.logger.debug(
      `[${correlationId}] Processing error.stored event for Socket.IO broadcast: ${event.production_error_id}`,
    );

    // Only emit for CRITICAL and HIGH severity errors for real-time notifications
    if (event.severity === ErrorSeverity.CRITICAL || event.severity === ErrorSeverity.HIGH) {
      // Fetch full error details from database for the payload
      const errorDetails = await this.prisma.productionError.findUnique({
        where: { id: event.production_error_id },
        select: {
          id: true,
          application: true,
          error_type: true,
          error_message: true,
          severity: true,
          occurred_at: true,
        },
      });

      if (errorDetails) {
        this.emitErrorCreatedEvent({
          id: errorDetails.id,
          application: errorDetails.application,
          error_type: errorDetails.error_type,
          severity: errorDetails.severity,
          occurred_at: errorDetails.occurred_at,
          message: errorDetails.error_message,
        });

        this.logger.log(
          `[${correlationId}] Emitted Socket.IO error.created event for ${event.severity} error ${event.production_error_id}`,
        );
      } else {
        this.logger.warn(
          `[${correlationId}] Error ${event.production_error_id} not found in database, skipping Socket.IO broadcast`,
        );
      }
    } else {
      this.logger.debug(
        `[${correlationId}] Skipping Socket.IO broadcast for ${event.severity} severity error`,
      );
    }
  }

  /**
   * Emit error.created event to Socket.IO production_events room
   */
  private emitErrorCreatedEvent(event: {
    id: string;
    application: string;
    error_type: string;
    severity: ErrorSeverity;
    occurred_at: Date;
    message: string;
  }): void {
    try {
      // Emit to production_events room
      this.realtimeGateway.server.to('production_events').emit('error.created', {
        id: event.id,
        application: event.application,
        error_type: event.error_type,
        severity: event.severity,
        occurred_at: event.occurred_at.toISOString(),
        message: event.message.substring(0, 200), // Truncate for payload size
      });
    } catch (error) {
      this.logger.error(
        `Failed to emit error.created event: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /**
   * Broadcast error acknowledged event
   * Called by dashboard controller when error is acknowledged
   */
  broadcastErrorAcknowledged(errorId: string, acknowledgedBy: string): void {
    try {
      this.realtimeGateway.server.to('production_events').emit('error.acknowledged', {
        id: errorId,
        acknowledged_by: acknowledgedBy,
        acknowledged_at: new Date().toISOString(),
      });

      this.logger.debug(`Broadcasted error.acknowledged event for ${errorId}`);
    } catch (error) {
      this.logger.error(
        `Failed to broadcast error.acknowledged event: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Broadcast ticket created event
   * Called by dashboard controller when ticket is created
   */
  broadcastTicketCreated(errorId: string, ticketUrl: string): void {
    try {
      this.realtimeGateway.server.to('production_events').emit('error.ticket_created', {
        id: errorId,
        ticket_url: ticketUrl,
        created_at: new Date().toISOString(),
      });

      this.logger.debug(`Broadcasted error.ticket_created event for ${errorId}`);
    } catch (error) {
      this.logger.error(
        `Failed to broadcast error.ticket_created event: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }
}
