import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Permission, Role } from '../../auth/constants/roles.enum';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { AuthenticatedUser } from '../../auth/interfaces/jwt-payload.interface';

/**
 * Permission-Based Access Control Guard
 * More granular than RolesGuard - checks specific permissions
 *
 * Usage:
 * @UseGuards(JwtAuthGuard, PermissionsGuard)
 * @RequirePermissions(Permission.CREATE_TICKET)
 * @Post('tickets')
 * createTicket() { }
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly logger = new Logger(PermissionsGuard.name);

  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Get required permissions from decorator
    const requiredPermissions = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // If no permissions required, allow access
    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    // Get user from request
    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthenticatedUser;

    if (!user) {
      this.logger.warn('PermissionsGuard: No user found on request.');
      throw new ForbiddenException('Access denied');
    }

    // ADMIN bypass - has all permissions
    if (user.role === Role.ADMIN) {
      return true;
    }

    // Check if user has ALL required permissions
    const hasAllPermissions = requiredPermissions.every((permission) =>
      user.permissions.includes(permission),
    );

    if (!hasAllPermissions) {
      const missingPermissions = requiredPermissions.filter((p) => !user.permissions.includes(p));
      this.logger.warn(
        `Access denied for user ${user.id}. Missing permissions: ${missingPermissions.join(', ')}`,
      );
      throw new ForbiddenException(
        `Access denied. Missing permissions: ${missingPermissions.join(', ')}`,
      );
    }

    return true;
  }
}
