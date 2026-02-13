import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, UsePipes, ValidationPipe, UseGuards, Inject, forwardRef } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { MetricsService } from '@/common/metrics/metrics.service';
import { ProjectService } from '@/projects/project.service';
import { JoinProjectDto, LeaveProjectDto } from './dto/join-room.dto';
import { RealtimeService } from './realtime.service';
import { WsAuthGuard } from './guards/ws-auth.guard';
import type {
  ExecutionProgressEvent,
  TicketUpdatedEvent,
  SystemAlertEvent,
} from './realtime.types';

// Re-export types for convenience
export type { ExecutionProgressEvent, TicketUpdatedEvent, SystemAlertEvent };
/**
 * Realtime Gateway - Socket.IO WebSocket Gateway
 * Story 10-U-1: Socket.IO Real-Time Infrastructure
 *
 * AC 1: Socket.IO Server Initialization
 * - Namespace: 'general' (default /) for low-volume, high-value events
 * - CORS configured from FRONTEND_URL environment variable
 * - HTTP to WebSocket upgrade support
 *
 * AC 2: WebSocket Authentication
 * - JWT authentication via WsAuthGuard
 * - User context attached to socket.data.user
 *
 * AC 3: Room & Namespace Management
 * - Dynamic project rooms: project:{id}
 * - Role-based rooms: role:{role}
 * - RBAC validation for project access
 *
 * AC 5: Connection Monitoring
 * - Logger for connection/disconnection events
 * - Prometheus metrics for active connections and events
 * - Automatic cleanup of stale connections
 */
@WebSocketGateway({
  // AC 5: Heartbeat mechanism for stale connection cleanup
  pingInterval: 25000, // Send ping every 25 seconds
  pingTimeout: 60000, // Wait 60 seconds for pong response
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
  },
})
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly metricsService: MetricsService,
    private readonly realtimeService: RealtimeService,
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => ProjectService))
    private readonly projectService: ProjectService,
  ) {}

  /**
   * AC 1: Gateway initialization
   */
  afterInit(server: Server): void {
    this.logger.log('RealtimeGateway initialized');
    this.logger.log(
      `CORS origin: ${this.configService.get('FRONTEND_URL', 'http://localhost:5173')}`,
    );

    // Register server with RealtimeService for external emissions
    this.realtimeService.setServer(server);

    // AC 5: Metrics are pre-registered by collectors, just log initialization
    this.logger.log('WebSocket metrics tracking enabled');
  }

  /**
   * AC 2 & AC 5: Handle new WebSocket connections
   * - Authenticate using JWT
   * - Log connection with user ID and IP
   * - Track Prometheus metrics
   */
  async handleConnection(client: Socket): Promise<void> {
    try {
      // Extract and verify JWT token
      const token = this.extractToken(client);
      if (!token) {
        this.logger.warn(
          `Connection attempt without token: ${client.id}, IP: ${client.handshake.address}`,
        );
        this.safeIncrementCounter('websocket_connection_errors', {
          reason: 'missing_token',
        });
        client.disconnect();
        return;
      }

      // Verify token and attach user payload
      const payload = await this.jwtService.verifyAsync(token);
      client.data.user = {
        userId: payload.sub,
        roles: payload.roles || [],
        email: payload.email,
      };

      // AC 5: Log connection event with User ID and IP
      this.logger.log(
        `Client connected: ${client.id}, User: ${payload.sub}, IP: ${client.handshake.address}`,
      );

      // AC 5: Track active connections metric
      this.safeIncrementGauge('websocket_active_connections', 1, {
        user_id: payload.sub,
      });

      // Auto-subscribe to user-specific room
      const userRoom = `user:${payload.sub}`;
      client.join(userRoom);
      this.logger.debug(`Client ${client.id} auto-joined room: ${userRoom}`);

      // Auto-subscribe to role-based rooms
      const roles = payload.roles || [];
      roles.forEach((role: string) => {
        const roleRoom = `role:${role}`;
        client.join(roleRoom);
        this.logger.debug(`Client ${client.id} joined role room: ${roleRoom}`);
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Connection error: ${errorMessage}, Client: ${client.id}, IP: ${client.handshake.address}`,
      );
      this.safeIncrementCounter('websocket_connection_errors', {
        reason: 'auth_failed',
      });
      client.disconnect();
    }
  }

  /**
   * AC 5: Handle client disconnection
   * - Log disconnection with User ID
   * - Decrement active connections metric
   * - Cleanup handled automatically by Socket.IO rooms
   */
  handleDisconnect(client: Socket): void {
    const userId = client.data.user?.userId || 'unknown';
    this.logger.log(`Client disconnected: ${client.id}, User: ${userId}`);

    // AC 5: Decrement active connections gauge
    this.safeIncrementGauge('websocket_active_connections', -1, {
      user_id: userId,
    });
  }

  /**
   * AC 3: Handle project room join requests
   * - Validate user access to project (RBAC check)
   * - Join project:{id} room
   */
  @SubscribeMessage('joinProject')
  @UsePipes(new ValidationPipe({ transform: true }))
  @UseGuards(WsAuthGuard)
  async handleJoinProject(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: JoinProjectDto,
  ): Promise<{ status: string; room: string; message?: string }> {
    const userId = client.data.user?.userId;
    const userRoles = client.data.user?.roles || [];
    const { projectId } = dto;

    this.logger.log(`User ${userId} requesting to join project: ${projectId}`);

    // AC 3: RBAC check - Validate user can access this project
    const canAccess = await this.canAccessProject(userId, userRoles, projectId);

    if (!canAccess) {
      this.logger.warn(`User ${userId} denied access to project ${projectId}`);
      this.safeIncrementCounter('websocket_events_total', {
        event: 'joinProject',
        result: 'denied',
      });
      return {
        status: 'error',
        room: `project:${projectId}`,
        message: 'Access denied to this project',
      };
    }

    const room = `project:${projectId}`;
    client.join(room);

    this.logger.log(`Client ${client.id} joined project room: ${room}`);
    this.safeIncrementCounter('websocket_events_total', {
      event: 'joinProject',
      result: 'success',
    });

    return { status: 'ok', room };
  }

  /**
   * Check if user can access a project
   * - ADMIN: Can access all projects
   * - MANAGER: Can access all projects
   * - PM: Can access projects they manage
   * - TL/QA/VIEWER: Can access projects based on assignment (simplified for now)
   */
  private async canAccessProject(
    userId: string,
    roles: string[],
    projectId: string,
  ): Promise<boolean> {
    // ADMIN and MANAGER can access all projects
    if (roles.includes('ADMIN') || roles.includes('MANAGER')) {
      return true;
    }

    try {
      // Get project details
      const project = await this.projectService.findOne(projectId);

      // PM can access their own projects
      if (roles.includes('PM') && project.pm_id === userId) {
        return true;
      }

      // For now, allow access if they have any role (already authenticated)
      // TODO: Implement project membership/assignment check
      this.logger.debug(`User ${userId} roles: ${roles.join(', ')}. Defaulting to allowed access.`);
      return true;
    } catch (error) {
      // Project not found or other error
      this.logger.warn(
        `Error checking project access for ${projectId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return false;
    }
  }

  /**
   * AC 3: Handle project room leave requests
   */
  @SubscribeMessage('leaveProject')
  @UsePipes(new ValidationPipe({ transform: true }))
  @UseGuards(WsAuthGuard) // CRITICAL FIX: Apply auth guard to handler
  handleLeaveProject(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: LeaveProjectDto,
  ): { status: string; room: string } {
    const { projectId } = dto;
    const room = `project:${projectId}`;

    client.leave(room);
    this.logger.log(`Client ${client.id} left project room: ${room}`);
    this.safeIncrementCounter('websocket_events_total', {
      event: 'leaveProject',
    });

    return { status: 'ok', room };
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

  /**
   * Safe wrapper for incrementGauge with error handling
   * FIX: HIGH issue #6 - Add error handling to metrics calls
   */
  private safeIncrementGauge(metric: string, value: number, labels?: Record<string, string>): void {
    try {
      this.metricsService.incrementGauge(metric, value, labels);
    } catch (error) {
      this.logger.error(
        `Failed to increment gauge ${metric}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Safe wrapper for incrementCounter with error handling
   * FIX: HIGH issue #6 - Add error handling to metrics calls
   */
  private safeIncrementCounter(metric: string, labels?: Record<string, string>): void {
    try {
      this.metricsService.incrementCounter(metric, labels);
    } catch (error) {
      this.logger.error(
        `Failed to increment counter ${metric}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }
}
