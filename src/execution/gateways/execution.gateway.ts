import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { MetricsService } from '@/common/metrics/metrics.service';
import { AIProvider, ExecutionStatus } from '@/prisma/client';

export interface ExecutionProgressPayload {
  executionId: string;
  ticketId: string;
  status: ExecutionStatus;
  timestamp: string;
  aiProvider: AIProvider;
  percentage?: number;
  message?: string;
}

export enum LogLevel {
  INFO = 'INFO',
  ERROR = 'ERROR',
  WARN = 'WARN',
  DEBUG = 'DEBUG',
}

export interface ExecutionLogPayload {
  executionId: string;
  ticketId: string;
  timestamp: string;
  level: LogLevel;
  message: string;
  source: 'stdout' | 'stderr';
}

export interface ServerToClientEvents {
  'execution-progress-update': (data: ExecutionProgressPayload) => void;
  'execution-completed': (data: { executionId: string; ticketId: string }) => void;
  'execution-log': (data: ExecutionLogPayload) => void;
}

export interface ClientToServerEvents {
  'subscribe-to-ticket': (ticketId: string) => void;
  'subscribe-to-execution-logs': (executionId: string) => void;
  'unsubscribe-from-execution-logs': (executionId: string) => void;
}

// Log buffer entry for throttling
interface LogBufferEntry {
  payload: ExecutionLogPayload;
  timer: NodeJS.Timeout;
}

/**
 * Detect log level from message content
 */
export function detectLogLevel(message: string): LogLevel {
  if (/\b(ERROR|FAIL|EXCEPTION|FATAL|CRASH)\b/i.test(message)) return LogLevel.ERROR;
  if (/\b(WARN|WARNING|CAUTION|ATTENTION)\b/i.test(message)) return LogLevel.WARN;
  if (/\b(DEBUG|TRACE|VERBOSE)\b/i.test(message)) return LogLevel.DEBUG;
  return LogLevel.INFO;
}

@WebSocketGateway({
  namespace: 'execution',
  cors: {
    origin: '*',
  },
})
export class ExecutionGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server<ClientToServerEvents, ServerToClientEvents>;

  private readonly logger = new Logger(ExecutionGateway.name);

  // Log throttling buffer
  private logBuffer = new Map<string, LogBufferEntry>();
  private readonly logThrottleMs: number;

  // Track which sockets are subscribed to which executions
  private executionLogSubscriptions = new Map<string, Set<string>>(); // executionId -> Set of socket IDs

  constructor(
    private readonly jwtService: JwtService,
    private readonly metricsService: MetricsService,
  ) {
    // Default throttle: 100ms, can be overridden via env
    this.logThrottleMs = parseInt(process.env.LOG_STREAM_THROTTLE_MS || '100', 10);
  }

  async handleConnection(client: Socket<ClientToServerEvents, ServerToClientEvents>) {
    try {
      const token = this.extractToken(client);
      if (!token) {
        this.logger.warn(`Connection attempt without token: ${client.id}`);
        client.disconnect();
        return;
      }

      const payload = await this.jwtService.verifyAsync(token);
      const userId = payload.sub;

      this.metricsService.incrementGauge('execution_socket_connections', 1, { user_id: userId });
      this.logger.log(`Client connected to execution namespace: ${client.id}, user: ${userId}`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Connection error in ExecutionGateway: ${errorMessage}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.metricsService.incrementGauge('execution_socket_connections', -1, {
      status: 'disconnected',
    });

    // Clean up subscriptions for this socket
    for (const [executionId, socketIds] of this.executionLogSubscriptions) {
      if (socketIds.has(client.id)) {
        socketIds.delete(client.id);
        if (socketIds.size === 0) {
          this.executionLogSubscriptions.delete(executionId);
        }
      }
    }

    this.logger.log(`Client disconnected from execution namespace: ${client.id}`);
  }

  @SubscribeMessage('subscribe-to-ticket')
  handleSubscribe(@ConnectedSocket() client: Socket, @MessageBody() ticketId: string) {
    this.logger.log(`Client ${client.id} subscribing to ticket: ${ticketId}`);
    client.join(`ticket_${ticketId}`);
    return { status: 'ok', joined: ticketId };
  }

  @SubscribeMessage('subscribe-to-execution-logs')
  handleSubscribeToLogs(@ConnectedSocket() client: Socket, @MessageBody() executionId: string) {
    this.logger.log(`Client ${client.id} subscribing to execution logs: ${executionId}`);

    // Add socket to execution room
    client.join(`execution_logs_${executionId}`);

    // Track subscription
    if (!this.executionLogSubscriptions.has(executionId)) {
      this.executionLogSubscriptions.set(executionId, new Set());
    }
    this.executionLogSubscriptions.get(executionId)!.add(client.id);

    this.metricsService.incrementCounter('execution_log_subscriptions_total', {
      execution_id: executionId,
    });

    return { status: 'ok', subscribed: executionId };
  }

  @SubscribeMessage('unsubscribe-from-execution-logs')
  handleUnsubscribeFromLogs(@ConnectedSocket() client: Socket, @MessageBody() executionId: string) {
    this.logger.log(`Client ${client.id} unsubscribing from execution logs: ${executionId}`);

    // Remove socket from execution room
    client.leave(`execution_logs_${executionId}`);

    // Update subscription tracking
    const socketIds = this.executionLogSubscriptions.get(executionId);
    if (socketIds) {
      socketIds.delete(client.id);
      if (socketIds.size === 0) {
        this.executionLogSubscriptions.delete(executionId);
      }
    }

    this.metricsService.decrementGauge('execution_log_subscriptions_active', 1, {
      execution_id: executionId,
    });

    return { status: 'ok', unsubscribed: executionId };
  }

  emitProgress(payload: ExecutionProgressPayload) {
    this.logger.debug(`Emitting progress for ticket ${payload.ticketId}: ${payload.status}`);
    this.server.to(`ticket_${payload.ticketId}`).emit('execution-progress-update', payload);
  }

  emitCompletion(executionId: string, ticketId: string) {
    this.logger.log(`Emitting completion for ticket ${ticketId}`);
    this.server.to(`ticket_${ticketId}`).emit('execution-completed', { executionId, ticketId });
  }

  /**
   * Emit a log message to all subscribers of an execution
   * AC 3: WebSocket log events via Socket.IO
   * AC 5: Error event emission on Docker/network issues
   *
   * @param executionId Execution ID
   * @param ticketId Ticket ID
   * @param message Log message
   * @param source 'stdout' or 'stderr'
   * @param level Optional log level (auto-detected if not provided)
   */
  emitLog(
    executionId: string,
    ticketId: string,
    message: string,
    source: 'stdout' | 'stderr' = 'stdout',
    level?: LogLevel,
  ): void {
    // Check if anyone is subscribed
    if (!this.executionLogSubscriptions.has(executionId)) {
      return; // No subscribers, skip
    }

    const detectedLevel = level || detectLogLevel(message);

    const payload: ExecutionLogPayload = {
      executionId,
      ticketId,
      timestamp: new Date().toISOString(),
      level: detectedLevel,
      message,
      source,
    };

    // Throttle rapid log messages
    const bufferKey = `${executionId}:${source}`;
    const existingEntry = this.logBuffer.get(bufferKey);

    if (existingEntry) {
      // Clear existing timer and update message (batching)
      clearTimeout(existingEntry.timer);
      // Add newline delimiter to separate batched messages
      existingEntry.payload.message += (existingEntry.payload.message ? '\n' : '') + message;
    }

    // Set new timer to emit after throttle interval
    const timer = setTimeout(() => {
      const entry = this.logBuffer.get(bufferKey);
      if (entry) {
        this.emitLogImmediate(entry.payload);
        this.logBuffer.delete(bufferKey);
      }
    }, this.logThrottleMs);

    this.logBuffer.set(bufferKey, {
      payload: existingEntry ? existingEntry.payload : payload,
      timer,
    });
  }

  /**
   * Emit log immediately without throttling
   * Use for important messages or errors
   */
  emitLogImmediate(payload: ExecutionLogPayload): void {
    this.server.to(`execution_logs_${payload.executionId}`).emit('execution-log', payload);

    // Track metrics
    this.metricsService.incrementCounter('execution_logs_emitted_total', {
      execution_id: payload.executionId,
      level: payload.level,
      source: payload.source,
    });
  }

  /**
   * Emit an error log immediately (bypasses throttling)
   * AC 5: Error event emission on Docker/network issues
   */
  emitErrorLog(
    executionId: string,
    ticketId: string,
    errorMessage: string,
    source: 'stdout' | 'stderr' = 'stderr',
  ): void {
    const payload: ExecutionLogPayload = {
      executionId,
      ticketId,
      timestamp: new Date().toISOString(),
      level: LogLevel.ERROR,
      message: errorMessage,
      source,
    };

    // Clear any buffered log for this execution to ensure error is sent first
    const bufferKey = `${executionId}:${source}`;
    const existingEntry = this.logBuffer.get(bufferKey);
    if (existingEntry) {
      clearTimeout(existingEntry.timer);
      this.logBuffer.delete(bufferKey);
    }

    this.emitLogImmediate(payload);
  }

  /**
   * Check if there are active subscribers for an execution
   */
  hasLogSubscribers(executionId: string): boolean {
    return this.executionLogSubscriptions.has(executionId);
  }

  /**
   * Get the count of log subscribers for an execution
   */
  getLogSubscriberCount(executionId: string): number {
    return this.executionLogSubscriptions.get(executionId)?.size || 0;
  }

  /**
   * Flush all pending log buffers
   * Call on shutdown or periodically
   */
  flushLogBuffers(): void {
    for (const [key, entry] of this.logBuffer) {
      clearTimeout(entry.timer);
      this.emitLogImmediate(entry.payload);
      this.logBuffer.delete(key);
    }
  }

  /**
   * Extract JWT token from WebSocket handshake
   * Supports Authorization header, auth object, and query parameter
   */
  private extractToken(client: Socket): string | null {
    // Try auth object first (client-side auth configuration)
    // Handle case where token might be an array
    const authToken = client.handshake.auth?.token;
    if (authToken) {
      const token = Array.isArray(authToken) ? authToken[0] : authToken;
      if (typeof token === 'string' && token.trim()) {
        return token.trim();
      }
    }

    // Try Authorization header
    const authHeader = client.handshake.headers?.authorization;
    if (authHeader) {
      const parts = authHeader.split(' ');
      if (parts.length === 2 && parts[0] === 'Bearer') {
        return parts[1];
      }
      // Handle case where someone sends just the token without "Bearer "
      if (typeof authHeader === 'string' && authHeader.includes('.')) {
        return authHeader.trim();
      }
    }

    // Try query parameter (less secure but supported for compatibility)
    // Handle case where query token might be an array
    const queryToken = client.handshake.query?.token;
    if (queryToken) {
      const token = Array.isArray(queryToken) ? queryToken[0] : queryToken;
      if (typeof token === 'string' && token.trim()) {
        return token.trim();
      }
    }

    return null;
  }
}
