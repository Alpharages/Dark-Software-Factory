/**
 * User roles for RBAC (Role-Based Access Control)
 * Per architecture.md Security Architecture section
 */
export enum Role {
  ADMIN = 'ADMIN', // Full access to all resources
  MANAGER = 'MANAGER', // Business oversight, all dashboards
  PM = 'PM', // Project Manager: Create tickets, view own projects, approve code
  TL = 'TL', // Tech Lead: Architecture review, technical oversight
  QA = 'QA', // Quality Assurance: Quality review, approve deployments
  VIEWER = 'VIEWER', // Read-only access to dashboards
}

/**
 * Permission types for fine-grained access control
 */
export enum Permission {
  CREATE_TICKET = 'CREATE_TICKET',
  APPROVE_CODE = 'APPROVE_CODE',
  REVIEW_ARCHITECTURE = 'REVIEW_ARCHITECTURE',
  APPROVE_DEPLOYMENT = 'APPROVE_DEPLOYMENT',
  VIEW_DASHBOARDS = 'VIEW_DASHBOARDS',
  CONFIGURE_SYSTEM = 'CONFIGURE_SYSTEM',
  VIEW_ALL_PROJECTS = 'VIEW_ALL_PROJECTS',
  VIEW_OWN_PROJECTS = 'VIEW_OWN_PROJECTS',
  MANAGE_USERS = 'MANAGE_USERS',
  VIEW_COSTS = 'VIEW_COSTS',
  SET_BUDGETS = 'SET_BUDGETS',
}

/**
 * Permission matrix mapping roles to permissions
 * Per architecture.md Permission Matrix
 *
 * | Resource           | ADMIN | MANAGER | PM  | TL  | QA  | VIEWER |
 * |-------------------|-------|---------|-----|-----|-----|--------|
 * | Create Ticket     | ✓     | ✓       | ✓   | -   | -   | -      |
 * | Approve Code      | ✓     | ✓       | ✓   | -   | -   | -      |
 * | Review Arch       | ✓     | -       | -   | ✓   | -   | -      |
 * | Approve Deploy    | ✓     | -       | -   | -   | ✓   | -      |
 * | View Dashboards   | ✓     | ✓       | ✓   | ✓   | ✓   | ✓      |
 * | Configure System  | ✓     | -       | -   | -   | -   | -      |
 */
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  [Role.ADMIN]: [
    Permission.CREATE_TICKET,
    Permission.APPROVE_CODE,
    Permission.REVIEW_ARCHITECTURE,
    Permission.APPROVE_DEPLOYMENT,
    Permission.VIEW_DASHBOARDS,
    Permission.CONFIGURE_SYSTEM,
    Permission.VIEW_ALL_PROJECTS,
    Permission.MANAGE_USERS,
    Permission.VIEW_COSTS,
    Permission.SET_BUDGETS,
  ],
  [Role.MANAGER]: [
    Permission.CREATE_TICKET,
    Permission.APPROVE_CODE,
    Permission.VIEW_DASHBOARDS,
    Permission.VIEW_ALL_PROJECTS,
    Permission.VIEW_COSTS,
    Permission.SET_BUDGETS,
  ],
  [Role.PM]: [
    Permission.CREATE_TICKET,
    Permission.APPROVE_CODE,
    Permission.VIEW_DASHBOARDS,
    Permission.VIEW_OWN_PROJECTS,
    Permission.VIEW_COSTS,
  ],
  [Role.TL]: [
    Permission.REVIEW_ARCHITECTURE,
    Permission.VIEW_DASHBOARDS,
    Permission.VIEW_OWN_PROJECTS,
  ],
  [Role.QA]: [
    Permission.APPROVE_DEPLOYMENT,
    Permission.VIEW_DASHBOARDS,
    Permission.VIEW_OWN_PROJECTS,
  ],
  [Role.VIEWER]: [Permission.VIEW_DASHBOARDS],
};

/**
 * Helper function to check if a role has a specific permission
 */
export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}
