import { Injectable, ExecutionContext, UnauthorizedException, Logger } from '@nestjs/common';
import { AuthGuard as PassportAuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * JWT Authentication Guard
 * Protects routes by requiring valid JWT tokens
 *
 * Per architecture.md:
 * - AuthGuard protects all routes by default
 * - Invalid/expired tokens return 401 Unauthorized
 * - Missing tokens on protected routes return 401 Unauthorized
 *
 * Usage:
 * Routes are protected by default. Use @Public() decorator to make a route public.
 */
@Injectable()
export class JwtAuthGuard extends PassportAuthGuard('jwt') {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(private reflector: Reflector) {
    super();
  }

  /**
   * Determine if the route can be activated
   * Checks for @Public() decorator to skip authentication
   */
  canActivate(context: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
    const request = context.switchToHttp().getRequest();
    const path = request.path || request.url;

    // Public paths that must be accessible without authentication
    const publicPaths = ['/metrics', '/health', '/ready', '/live'];
    if (publicPaths.some((publicPath) => path === publicPath)) {
      return true;
    }

    // Check if route is marked as public
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    // Call parent implementation (Passport JWT validation)
    return super.canActivate(context);
  }

  /**
   * Handle request after Passport processes it
   * Called by Passport after JWT validation
   */
  handleRequest<TUser = unknown>(
    err: unknown,
    user: TUser,
    info: { name?: string; message?: string },
    context: ExecutionContext,
  ): TUser {
    const request = context.switchToHttp().getRequest();
    const path = request.path;

    // Handle authentication errors
    if (err) {
      // Assuming err has a message property if it's an error object
      const errorMessage = (err as Error).message || 'Unknown authentication error';
      this.logger.warn(`Auth error on ${path}: ${errorMessage}`);
      throw new UnauthorizedException('Authentication failed');
    }

    // Handle missing or invalid token
    if (!user) {
      if (info?.name === 'TokenExpiredError') {
        this.logger.debug(`Expired token on ${path}`);
        throw new UnauthorizedException('Token has expired');
      }

      if (info?.name === 'JsonWebTokenError') {
        this.logger.warn(`Invalid token on ${path}: ${info.message}`);
        throw new UnauthorizedException('Invalid token');
      }

      if (info?.name === 'NotBeforeError') {
        this.logger.warn(`Token not yet valid on ${path}`);
        throw new UnauthorizedException('Token not yet valid');
      }

      // No token provided
      this.logger.debug(`No token provided on ${path}`);
      throw new UnauthorizedException('Authentication required');
    }

    return user;
  }
}
