import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '../../auth/constants/roles.enum';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AuthenticatedUser } from '../../auth/interfaces/jwt-payload.interface';

/**
 * Role-Based Access Control (RBAC) Guard
 * Enforces role requirements on routes
 *
 * Per architecture.md Authorization (RBAC):
 * - RolesGuard enforces role-based permissions
 * - Permission Matrix defines which roles can access which resources
 *
 * Usage:
 * @UseGuards(JwtAuthGuard, RolesGuard)
 * @Roles('PM', 'ADMIN')
 * @Post('tickets')
 * createTicket() { }
 */
@Injectable()
export class RolesGuard implements CanActivate {
  private readonly logger = new Logger(RolesGuard.name);

  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Get required roles from decorator
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // If no roles required, allow access
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    // Get user from request (set by JwtAuthGuard)
    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthenticatedUser;

    if (!user) {
      this.logger.warn('RolesGuard: No user found on request. JwtAuthGuard should run first.');
      throw new ForbiddenException('Access denied');
    }

    // Check if user has any of the required roles
    // ADMIN role always has access (superuser)
    const hasRole = user.role === Role.ADMIN || requiredRoles.includes(user.role);

    if (!hasRole) {
      this.logger.warn(
        `Access denied for user ${user.id} with role ${user.role}. Required: ${requiredRoles.join(', ')}`,
      );
      throw new ForbiddenException(`Access denied. Required role: ${requiredRoles.join(' or ')}`);
    }

    this.logger.debug(`Access granted for user ${user.id} with role ${user.role}`);
    return true;
  }
}
