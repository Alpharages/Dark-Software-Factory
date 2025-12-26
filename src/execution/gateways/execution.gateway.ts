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
import { Logger, UseGuards } from '@nestjs/common';
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

export interface ServerToClientEvents {
  'execution-progress-update': (data: ExecutionProgressPayload) => void;
  'execution-completed': (data: { executionId: string; ticketId: string }) => void;
}

export interface ClientToServerEvents {
  'subscribe-to-ticket': (ticketId: string) => void;
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

  constructor(
    private readonly jwtService: JwtService,
    private readonly metricsService: MetricsService,
  ) {}

  async handleConnection(client: Socket<ClientToServerEvents, ServerToClientEvents>) {
    try {
      const token =
        client.handshake.auth?.token || client.handshake.headers?.authorization?.split(' ')[1];
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
    this.logger.log(`Client disconnected from execution namespace: ${client.id}`);
  }

  @SubscribeMessage('subscribe-to-ticket')
  handleSubscribe(@ConnectedSocket() client: Socket, @MessageBody() ticketId: string) {
    this.logger.log(`Client ${client.id} subscribing to ticket: ${ticketId}`);
    client.join(`ticket_${ticketId}`);
    return { status: 'ok', joined: ticketId };
  }

  emitProgress(payload: ExecutionProgressPayload) {
    this.logger.debug(`Emitting progress for ticket ${payload.ticketId}: ${payload.status}`);
    this.server.to(`ticket_${payload.ticketId}`).emit('execution-progress-update', payload);
  }

  emitCompletion(executionId: string, ticketId: string) {
    this.logger.log(`Emitting completion for ticket ${ticketId}`);
    this.server.to(`ticket_${ticketId}`).emit('execution-completed', { executionId, ticketId });
  }
}
