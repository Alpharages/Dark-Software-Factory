import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { Server } from 'socket.io';
import { NotificationDispatcherService } from '../notifications/services/notification-dispatcher.service';

/**
 * Realtime Service - Abstraction layer for Socket.IO emissions
 * Story 10-U-1 AC 4: Event Emission Service
 *
 * Provides typed methods for emitting events to:
 * - Specific projects (room-based)
 * - Specific roles (role-based rooms)
 * - Specific users (user-specific rooms)
 *
 * Handles offline clients gracefully (fire-and-forget)
 */
@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);
  private server?: Server;

  constructor(
    @Inject(forwardRef(() => NotificationDispatcherService))
    private readonly notificationDispatcher: NotificationDispatcherService,
  ) {}

  /**
   * Set the Socket.IO server instance
   * Called by RealtimeGateway during initialization
   */
  setServer(server: Server): void {
    this.server = server;
    this.logger.log('Socket.IO server instance registered with RealtimeService');
  }

  /**
   * Emit event to all members of a project room
   * AC 4: emitToProject(projectId, event, payload)
   *
   * @param projectId Project identifier
   * @param event Event name
   * @param payload Event payload
   */
  emitToProject(projectId: string, event: string, payload: unknown): void {
    if (!this.server) {
      this.logger.warn('emitToProject called before server initialization');
      return;
    }

    const room = `project:${projectId}`;
    this.server.to(room).emit(event, payload);
    this.logger.debug(`Emitted '${event}' to project room: ${room}`);

    // Trigger multi-channel notifications for project-level events?
    // For now, focusing on user-specific events as per AC, but could be extended.
  }

  /**
   * Emit event to all users with a specific role
   * AC 4: emitToRole(role, event, payload)
   *
   * @param role User role (e.g., 'admin', 'pm', 'developer')
   * @param event Event name
   * @param payload Event payload
   */
  emitToRole(role: string, event: string, payload: unknown): void {
    if (!this.server) {
      this.logger.warn('emitToRole called before server initialization');
      return;
    }

    const room = `role:${role}`;
    this.server.to(room).emit(event, payload);
    this.logger.debug(`Emitted '${event}' to role room: ${room}`);
  }

  /**
   * Emit event to a specific user
   * AC 4: emitToUser(userId, event, payload)
   *
   * @param userId User identifier
   * @param event Event name
   * @param payload Event payload
   */
  emitToUser(userId: string, event: string, payload: unknown): void {
    if (!this.server) {
      this.logger.warn('emitToUser called before server initialization');
      return;
    }

    const room = `user:${userId}`;
    this.server.to(room).emit(event, payload);
    this.logger.debug(`Emitted '${event}' to user room: ${room}`);

    // Trigger multi-channel notification dispatcher
    const p = payload as Record<string, unknown>;
    this.notificationDispatcher
      .dispatch({
        userId,
        eventType: event,
        title: p.title as string,
        message: p.message as string,
        payload: p,
      })
      .catch((err) => {
        this.logger.error(`Failed to trigger notification dispatcher for user ${userId}:`, err);
      });
  }

  /**
   * Broadcast event to all connected clients
   * Use sparingly - prefer targeted emissions
   *
   * @param event Event name
   * @param payload Event payload
   */
  broadcast(event: string, payload: unknown): void {
    if (!this.server) {
      this.logger.warn('broadcast called before server initialization');
      return;
    }

    this.server.emit(event, payload);
    this.logger.debug(`Broadcasted '${event}' to all clients`);
  }
}
