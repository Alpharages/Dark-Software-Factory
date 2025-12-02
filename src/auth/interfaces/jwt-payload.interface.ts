import { Role } from '../constants/roles.enum';

/**
 * JWT payload structure - issued by EXTERNAL auth service
 *
 * Per architecture.md Authentication Flow:
 * "JWT contains claims: { userId, role, permissions, exp }"
 *
 * The orchestrator validates these tokens but does NOT issue them.
 * Users are managed by the separate auth service.
 */
export interface JwtPayload {
  /** User's unique identifier (UUID) */
  sub: string;

  /** User's email address */
  email: string;

  /** User's display name */
  name: string;

  /** User's role for RBAC */
  role: Role;

  /** Optional: Direct permissions (override role permissions) */
  permissions?: string[];

  /** Token issued at timestamp (Unix epoch) */
  iat?: number;

  /** Token expiration timestamp (Unix epoch) */
  exp?: number;
}

/**
 * User object attached to request after JWT validation
 */
export interface AuthenticatedUser {
  /** User's unique identifier (UUID) */
  id: string;

  /** User's email address */
  email: string;

  /** User's display name */
  name: string;

  /** User's role for RBAC */
  role: Role;

  /** Resolved permissions (from role + direct permissions) */
  permissions: string[];
}
