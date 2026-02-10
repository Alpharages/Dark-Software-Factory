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

export interface ServerToClientEvents {
  'project-updated': (data: Record<string, unknown>) => void;
  'summary-updated': (data: Record<string, unknown>) => void;
  'ticket-updated': (data: Record<string, unknown>) => void;
  'quality-update': (data: Record<string, unknown>) => void;
  'quality-alert': (data: Record<string, unknown>) => void;
  'quality-anomaly-detected': (data: Record<string, unknown>) => void;
  'qa-workload-alert': (data: Record<string, unknown>) => void;
}

export interface ClientToServerEvents {
  'subscribe-to-projects': (projectIds: string[]) => void;
  'subscribe-to-quality-updates': (projectIds: string[]) => void;
}

@WebSocketGateway({
  namespace: 'dashboard',
  cors: {
    origin: '*',
  },
})
export class DashboardGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server<ClientToServerEvents, ServerToClientEvents>;

  private readonly logger = new Logger(DashboardGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly metricsService: MetricsService,
  ) {}

  async handleConnection(client: Socket<ClientToServerEvents, ServerToClientEvents>) {
    try {
      const rawToken = this.extractToken(client);
      if (!rawToken) {
        this.logger.warn(`Connection attempt without token: ${client.id}`);
        client.disconnect();
        return;
      }

      const payload = await this.jwtService.verifyAsync(rawToken);
      const userId = payload.sub;

      client.join(`pm_${userId}`);
      this.metricsService.incrementGauge('pm_dashboard_socket_connections', 1, { user_id: userId });
      this.logger.log(`Client connected: ${client.id}, joined room: pm_${userId}`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Connection error: ${errorMessage}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.metricsService.incrementGauge('pm_dashboard_socket_connections', -1, {
      status: 'disconnected',
    });
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  emitToRoom(roomId: string, event: keyof ServerToClientEvents, data: Record<string, unknown>) {
    this.server.to(roomId).emit(event as keyof ServerToClientEvents, data);
  }

  @SubscribeMessage('subscribe-to-projects')
  handleSubscribe(@ConnectedSocket() client: Socket, @MessageBody() projectIds: string[]) {
    projectIds.forEach((id) => client.join(`project_${id}`));
    return { status: 'ok', joined: projectIds };
  }

  @SubscribeMessage('subscribe-to-quality-updates')
  handleSubscribeQuality(@ConnectedSocket() client: Socket, @MessageBody() projectIds: string[]) {
    projectIds.forEach((id) => client.join(`quality_${id}`));
    return { status: 'ok', joined: projectIds };
  }

  broadcastQualityUpdate(projectId: string, data: Record<string, unknown>) {
    // Emit to specific project room
    this.server.to(`quality_${projectId}`).emit('quality-update', data);

    // Also emit to global quality room if needed, or PMs
    // For now, assuming PMs subscribe to projects they care about
  }

  /**
   * Extract JWT token from WebSocket handshake
   * Supports Authorization header, auth object, and query parameter
   */
  private extractToken(client: Socket): string | null {
    // Try auth object first (client-side auth configuration)
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
    }

    // Try query parameter (less secure but supported for compatibility)
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
