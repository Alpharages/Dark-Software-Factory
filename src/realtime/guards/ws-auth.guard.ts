import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Socket } from 'socket.io';

/**
 * WebSocket Authentication Guard
 * Story 10-U-1 AC 2: WebSocket Authentication
 *
 * Validates JWT tokens from WebSocket handshake
 * - Checks Authorization header or query parameter
 * - Verifies token using JwtService
 * - Attaches user payload to socket.data.user
 * - Disconnects on invalid/missing tokens with 401
 */
@Injectable()
export class WsAuthGuard implements CanActivate {
  private readonly logger = new Logger(WsAuthGuard.name);

  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      const client: Socket = context.switchToWs().getClient<Socket>();
      const token = this.extractToken(client);

      if (!token) {
        this.logger.warn(`WebSocket connection attempt without token: ${client.id}`);
        client.disconnect();
        return false;
      }

      // Verify token and extract payload
      const payload = await this.jwtService.verifyAsync(token);

      // Attach user context to socket for downstream use
      client.data.user = {
        userId: payload.sub,
        roles: payload.roles || [],
        email: payload.email,
      };

      this.logger.debug(`WebSocket authenticated: ${client.id}, user: ${payload.sub}`);
      return true;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`WebSocket authentication failed: ${errorMessage}`);

      const client: Socket = context.switchToWs().getClient<Socket>();
      client.disconnect();
      return false;
    }
  }

  /**
   * Extract JWT token from WebSocket handshake
   * Supports both Authorization header and query parameter
   */
  private extractToken(client: Socket): string | null {
    // Try auth object first (client-side auth configuration)
    if (client.handshake.auth?.token) {
      return client.handshake.auth.token;
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
    if (client.handshake.query?.token) {
      return client.handshake.query.token as string;
    }

    return null;
  }
}
