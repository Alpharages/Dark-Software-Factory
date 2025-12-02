import { SetMetadata } from '@nestjs/common';
import { Permission } from '../../auth/constants/roles.enum';

/**
 * Metadata key for permission requirements
 */
export const PERMISSIONS_KEY = 'permissions';

/**
 * Decorator to specify required permissions for a route
 * User must have ALL of the specified permissions
 *
 * Usage:
 * @RequirePermissions(Permission.CREATE_TICKET, Permission.VIEW_OWN_PROJECTS)
 * @Post('tickets')
 * createTicket() { }
 */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
