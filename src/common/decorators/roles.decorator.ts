import { SetMetadata } from '@nestjs/common';
import { Role } from '../../auth/constants/roles.enum';

/**
 * Metadata key for role requirements
 */
export const ROLES_KEY = 'roles';

/**
 * Decorator to specify required roles for a route
 * User must have at least ONE of the specified roles
 *
 * Usage:
 * @Roles(Role.PM, Role.ADMIN)
 * @Post('tickets')
 * createTicket() { }
 *
 * Can also use string literals:
 * @Roles('PM', 'ADMIN')
 */
export const Roles = (...roles: (Role | string)[]) => SetMetadata(ROLES_KEY, roles as Role[]);
