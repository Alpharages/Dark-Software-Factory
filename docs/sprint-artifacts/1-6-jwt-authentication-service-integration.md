# Story 1.6: JWT Authentication Service Integration

**Epic:** 1 - Foundation & Development Environment  
**Status:** `done`  
**Priority:** P0 - BLOCKER  
**Effort:** 5 story points  
**ClickUp ID:** `86evnjw8k`  
**ClickUp URL:** https://app.clickup.com/t/86evnjw8k

---

## Story

As a developer,
I want JWT-based authentication integrated with the separate auth service,
So that all endpoints are secured with role-based access control.

---

## Acceptance Criteria

**Given** the separate auth service is available (or mocked for dev)  
**When** I implement JWT authentication  
**Then** the following is configured:
- `@nestjs/jwt` and `@nestjs/passport` installed
- JWT strategy validates tokens using shared secret
- AuthGuard protects all routes by default
- JWT tokens contain claims: userId, role, permissions, exp

**And** these roles are defined (per architecture):
- ADMIN (full access)
- MANAGER (business oversight)
- PM (ticket creation, approval)
- TL (architecture review)
- QA (quality approval)
- VIEWER (read-only)

**And** RolesGuard enforces role-based permissions  
**And** `@CurrentUser()` decorator extracts user from JWT  
**And** Invalid/expired tokens return 401 Unauthorized  
**And** Missing tokens on protected routes return 401 Unauthorized

---

## Technical Requirements

### Quick Reference: Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/auth/constants/roles.enum.ts` | CREATE | Role & Permission definitions |
| `src/auth/interfaces/jwt-payload.interface.ts` | CREATE | JWT & User type definitions |
| `src/auth/strategies/jwt.strategy.ts` | CREATE | JWT validation strategy |
| `src/auth/auth.module.ts` | MODIFY | Add Passport & JWT modules |
| `src/common/guards/auth.guard.ts` | CREATE | JWT authentication guard |
| `src/common/guards/roles.guard.ts` | CREATE | RBAC guard |
| `src/common/guards/permissions.guard.ts` | CREATE | Fine-grained permissions (optional) |
| `src/common/guards/index.ts` | CREATE | Guards barrel export |
| `src/common/decorators/public.decorator.ts` | CREATE | @Public() decorator |
| `src/common/decorators/roles.decorator.ts` | CREATE | @Roles() decorator |
| `src/common/decorators/permissions.decorator.ts` | CREATE | @RequirePermissions() decorator |
| `src/common/decorators/current-user.decorator.ts` | CREATE | @CurrentUser() decorator |
| `src/common/decorators/index.ts` | CREATE | Decorators barrel export |
| `src/app.module.ts` | MODIFY | Add global APP_GUARD |
| `src/app.controller.ts` | MODIFY | Add @Public() to health routes |

**Install Command:**
```bash
npm install @nestjs/jwt @nestjs/passport passport passport-jwt && npm install -D @types/passport-jwt
```

---

### Step 1: Install Authentication Dependencies

```bash
# Install Passport and JWT packages
npm install @nestjs/jwt @nestjs/passport passport passport-jwt

# Install TypeScript types
npm install -D @types/passport-jwt
```

**Why these dependencies:**
- `@nestjs/jwt` - NestJS wrapper around jsonwebtoken for JWT handling
- `@nestjs/passport` - NestJS integration with Passport.js authentication middleware
- `passport` - Authentication middleware for Node.js
- `passport-jwt` - JWT strategy for Passport
- `@types/passport-jwt` - TypeScript definitions

---

### Step 2: Define Roles and Permissions

**File:** `src/auth/constants/roles.enum.ts`

```typescript
/**
 * User roles for RBAC (Role-Based Access Control)
 * Per architecture.md Security Architecture section
 */
export enum Role {
  ADMIN = 'ADMIN',       // Full access to all resources
  MANAGER = 'MANAGER',   // Business oversight, all dashboards
  PM = 'PM',             // Project Manager: Create tickets, view own projects, approve code
  TL = 'TL',             // Tech Lead: Architecture review, technical oversight
  QA = 'QA',             // Quality Assurance: Quality review, approve deployments
  VIEWER = 'VIEWER',     // Read-only access to dashboards
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
  [Role.VIEWER]: [
    Permission.VIEW_DASHBOARDS,
  ],
};

/**
 * Helper function to check if a role has a specific permission
 */
export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}
```

---

### Step 3: Define JWT Payload Interface

**File:** `src/auth/interfaces/jwt-payload.interface.ts`

**NOTE:** This interface defines the structure of JWTs issued by the **external auth service**. The orchestrator does not create these tokens - it only validates them.

```typescript
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
```

---

### Step 4: Create JWT Strategy

**File:** `src/auth/strategies/jwt.strategy.ts`

```typescript
import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { JwtPayload, AuthenticatedUser } from '../interfaces/jwt-payload.interface';
import { Role, ROLE_PERMISSIONS } from '../constants/roles.enum';

/**
 * JWT Strategy for Passport
 * Validates JWT tokens and extracts user information
 * 
 * Per architecture.md Authentication Flow:
 * 1. Frontend includes JWT in requests: Authorization: Bearer {jwt}
 * 2. Orchestrator validates JWT via auth.guard.ts:
 *    - Verifies signature using shared secret
 *    - Checks expiration
 *    - Extracts user claims
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(private readonly configService: ConfigService) {
    const jwtSecret = configService.get<string>('auth.jwtSecret');
    
    if (!jwtSecret) {
      throw new Error('JWT_SECRET is not configured. Set it in your .env file.');
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false, // Automatically reject expired tokens
      secretOrKey: jwtSecret,
      algorithms: ['HS256'], // Only accept HS256 signed tokens
    });

    this.logger.log('JWT Strategy initialized');
  }

  /**
   * Validate JWT payload and transform to AuthenticatedUser
   * Called automatically by Passport after token signature verification
   * 
   * @param payload - Decoded JWT payload
   * @returns AuthenticatedUser object attached to request
   * @throws UnauthorizedException if validation fails
   */
  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    // Validate required fields
    if (!payload.sub) {
      this.logger.warn('JWT missing required field: sub');
      throw new UnauthorizedException('Invalid token: missing user ID');
    }

    if (!payload.role) {
      this.logger.warn(`JWT missing role for user ${payload.sub}`);
      throw new UnauthorizedException('Invalid token: missing role');
    }

    // Validate role is a known role
    if (!Object.values(Role).includes(payload.role)) {
      this.logger.warn(`JWT contains invalid role: ${payload.role}`);
      throw new UnauthorizedException('Invalid token: invalid role');
    }

    // Resolve permissions from role + any direct permissions
    const rolePermissions = ROLE_PERMISSIONS[payload.role] || [];
    const directPermissions = payload.permissions || [];
    const allPermissions = [...new Set([...rolePermissions, ...directPermissions])];

    this.logger.debug(`User ${payload.sub} authenticated with role ${payload.role}`);

    return {
      id: payload.sub,
      email: payload.email,
      name: payload.name,
      role: payload.role,
      permissions: allPermissions,
    };
  }
}
```

---

### Step 5: Create Auth Guard

**File:** `src/common/guards/auth.guard.ts`

```typescript
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
  handleRequest<TUser = any>(
    err: any,
    user: TUser,
    info: any,
    context: ExecutionContext,
  ): TUser {
    const request = context.switchToHttp().getRequest();
    const path = request.path;

    // Handle authentication errors
    if (err) {
      this.logger.warn(`Auth error on ${path}: ${err.message}`);
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
```

---

### Step 6: Create Roles Guard

**File:** `src/common/guards/roles.guard.ts`

```typescript
import { Injectable, CanActivate, ExecutionContext, ForbiddenException, Logger } from '@nestjs/common';
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
      throw new ForbiddenException(
        `Access denied. Required role: ${requiredRoles.join(' or ')}`,
      );
    }

    this.logger.debug(`Access granted for user ${user.id} with role ${user.role}`);
    return true;
  }
}
```

---

### Step 7: Create Permissions Guard (Optional Advanced RBAC)

**File:** `src/common/guards/permissions.guard.ts`

```typescript
import { Injectable, CanActivate, ExecutionContext, ForbiddenException, Logger } from '@nestjs/common';
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
    const requiredPermissions = this.reflector.getAllAndOverride<Permission[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

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
      const missingPermissions = requiredPermissions.filter(
        (p) => !user.permissions.includes(p),
      );
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
```

---

### Step 8: Create Decorators

**File:** `src/common/decorators/public.decorator.ts`

```typescript
import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key for public routes
 */
export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Decorator to mark routes as public (no authentication required)
 * 
 * Usage:
 * @Public()
 * @Get('health')
 * getHealth() { }
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
```

---

**File:** `src/common/decorators/roles.decorator.ts`

```typescript
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
export const Roles = (...roles: (Role | string)[]) => 
  SetMetadata(ROLES_KEY, roles as Role[]);
```

---

**File:** `src/common/decorators/permissions.decorator.ts`

```typescript
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
```

---

**File:** `src/common/decorators/current-user.decorator.ts`

```typescript
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedUser } from '../../auth/interfaces/jwt-payload.interface';

/**
 * Decorator to extract the current user from the request
 * Works after JwtAuthGuard has validated the token
 * 
 * Per architecture.md:
 * "Route handlers access user via @CurrentUser() decorator"
 * 
 * Usage:
 * @Get('profile')
 * getProfile(@CurrentUser() user: AuthenticatedUser) {
 *   return { id: user.id, email: user.email };
 * }
 * 
 * @Get('role')
 * getRole(@CurrentUser('role') role: Role) {
 *   return { role };
 * }
 */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as AuthenticatedUser;

    // If no data key specified, return entire user object
    if (!data) {
      return user;
    }

    // Return specific property of user
    return user?.[data];
  },
);
```

---

### Step 9: Create Auth Module

**File:** `src/auth/auth.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtStrategy } from './strategies/jwt.strategy';

/**
 * Authentication Module
 * 
 * Provides:
 * - JWT validation via Passport
 * - JwtStrategy for token extraction and validation
 * 
 * Per architecture.md:
 * - Separate Auth Service issues JWTs (external)
 * - Orchestrator validates JWTs (this module)
 */
@Module({
  imports: [
    // Enable Passport with JWT as default strategy
    PassportModule.register({ defaultStrategy: 'jwt' }),
    
    // Configure JWT module (for token verification)
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('auth.jwtSecret'),
        signOptions: {
          expiresIn: '24h', // Default expiration (auth service may override)
          algorithm: 'HS256',
        },
        verifyOptions: {
          algorithms: ['HS256'],
        },
      }),
    }),
  ],
  providers: [JwtStrategy],
  exports: [PassportModule, JwtModule],
})
export class AuthModule {}
```

---

### Step 10: Create Guards Index for Easy Imports

**File:** `src/common/guards/index.ts`

```typescript
export { JwtAuthGuard } from './auth.guard';
export { RolesGuard } from './roles.guard';
export { PermissionsGuard } from './permissions.guard';
```

---

**File:** `src/common/decorators/index.ts`

```typescript
export { Public, IS_PUBLIC_KEY } from './public.decorator';
export { Roles, ROLES_KEY } from './roles.decorator';
export { RequirePermissions, PERMISSIONS_KEY } from './permissions.decorator';
export { CurrentUser } from './current-user.decorator';
```

---

### Step 11: Configure Global Authentication

**File:** `src/app.module.ts` (update existing file)

**IMPORTANT:** The current `app.module.ts` already has all module imports. You are ONLY adding:
1. The `APP_GUARD` import from `@nestjs/core`
2. The `JwtAuthGuard` import from `./common/guards`
3. The global guard provider in the providers array

```typescript
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core'; // ADD THIS IMPORT
import { AppController } from './app.controller';
import { AppService } from './app.service';

// Configuration & Database (Global modules)
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';

// Authentication
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './common/guards'; // ADD THIS IMPORT

// Core workflow modules
import { WebhooksModule } from './webhooks/webhooks.module';
import { TicketIntakeModule } from './ticket-intake/ticket-intake.module';
import { RabbitmqModule } from './rabbitmq/rabbitmq.module';
import { AiRoutingModule } from './ai-routing/ai-routing.module';
import { ExecutionModule } from './execution/execution.module';

// Quality & Deployment
import { QaAutomationModule } from './qa-automation/qa-automation.module';
import { GithubModule } from './github/github.module';
import { DeploymentModule } from './deployment/deployment.module';

// Monitoring & Metrics
import { ProductionMonitoringModule } from './production-monitoring/production-monitoring.module';
import { CostTrackingModule } from './cost-tracking/cost-tracking.module';
import { MetricsModule } from './metrics/metrics.module';

// User interfaces
import { DashboardsModule } from './dashboards/dashboards.module';
import { RealtimeModule } from './realtime/realtime.module';

// External integrations
import { IntegrationModule } from './integration/integration.module';

@Module({
  imports: [
    // Global modules (available everywhere)
    ConfigModule,
    DatabaseModule,

    // Authentication
    AuthModule,

    // Core workflow
    WebhooksModule,
    TicketIntakeModule,
    RabbitmqModule,
    AiRoutingModule,
    ExecutionModule,

    // Quality & Deployment
    QaAutomationModule,
    GithubModule,
    DeploymentModule,

    // Monitoring & Metrics
    ProductionMonitoringModule,
    CostTrackingModule,
    MetricsModule,

    // User interfaces
    DashboardsModule,
    RealtimeModule,

    // External integrations
    IntegrationModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    
    // ADD THIS: Apply JwtAuthGuard globally
    // All routes require authentication by default
    // Use @Public() decorator to make routes public
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule {}
```

**Changes Summary:**
- Line 2: Add `APP_GUARD` import from `@nestjs/core`
- Line 12: Add `JwtAuthGuard` import from `./common/guards`
- Lines 67-72: Add global guard provider to `providers` array

---

### Step 12: Update AppController for Public Routes

**File:** `src/app.controller.ts` (update)

```typescript
import { Controller, Get, UseGuards } from '@nestjs/common';
import { AppService } from './app.service';
import { PrismaService } from './database/prisma.service';
import { RabbitMQService } from './rabbitmq/rabbitmq.service';
import { Public, CurrentUser, Roles } from './common/decorators';
import { RolesGuard } from './common/guards';
import { AuthenticatedUser } from './auth/interfaces/jwt-payload.interface';
import { Role } from './auth/constants/roles.enum';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly prismaService: PrismaService,
    private readonly rabbitMQService: RabbitMQService,
  ) {}

  // Public route - no authentication required
  @Public()
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  // Public route - health check must be accessible for monitoring
  @Public()
  @Get('health')
  async getHealth() {
    const dbHealthy = await this.checkDatabaseHealth();
    const rabbitMQHealthy = await this.rabbitMQService.isHealthy();

    const isHealthy = dbHealthy && rabbitMQHealthy;

    return {
      status: isHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      services: {
        database: dbHealthy ? 'up' : 'down',
        rabbitmq: rabbitMQHealthy ? 'up' : 'down',
      },
    };
  }

  // Protected route - requires authentication
  @Get('profile')
  getProfile(@CurrentUser() user: AuthenticatedUser) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    };
  }

  // Protected route with role requirement
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN, Role.MANAGER)
  @Get('admin/stats')
  getAdminStats() {
    return {
      message: 'Admin only stats',
      timestamp: new Date().toISOString(),
    };
  }

  private async checkDatabaseHealth(): Promise<boolean> {
    try {
      await this.prismaService.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
```

---

## Testing Configuration

### Unit Test: JWT Strategy

**File:** `src/auth/strategies/jwt.strategy.spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';
import { Role } from '../constants/roles.enum';
import { JwtPayload } from '../interfaces/jwt-payload.interface';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockImplementation((key: string) => {
              if (key === 'auth.jwtSecret') {
                return 'test-secret-at-least-32-characters-long';
              }
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    strategy = module.get<JwtStrategy>(JwtStrategy);
  });

  it('should be defined', () => {
    expect(strategy).toBeDefined();
  });

  describe('validate', () => {
    it('should return authenticated user for valid payload', async () => {
      const payload: JwtPayload = {
        sub: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        role: Role.PM,
      };

      const result = await strategy.validate(payload);

      expect(result).toEqual({
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        role: Role.PM,
        permissions: expect.arrayContaining(['CREATE_TICKET', 'VIEW_DASHBOARDS']),
      });
    });

    it('should throw UnauthorizedException for missing sub', async () => {
      const payload: JwtPayload = {
        sub: '',
        email: 'test@example.com',
        name: 'Test User',
        role: Role.PM,
      };

      await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException for missing role', async () => {
      const payload = {
        sub: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
      } as JwtPayload;

      await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException for invalid role', async () => {
      const payload = {
        sub: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        role: 'INVALID_ROLE',
      } as unknown as JwtPayload;

      await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
    });

    it('should include direct permissions in result', async () => {
      const payload: JwtPayload = {
        sub: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        role: Role.VIEWER,
        permissions: ['CUSTOM_PERMISSION'],
      };

      const result = await strategy.validate(payload);

      expect(result.permissions).toContain('CUSTOM_PERMISSION');
      expect(result.permissions).toContain('VIEW_DASHBOARDS');
    });
  });
});
```

---

### Unit Test: Roles Guard

**File:** `src/common/guards/roles.guard.spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { Role } from '../../auth/constants/roles.enum';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  const mockExecutionContext = (user: any): ExecutionContext => ({
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: jest.fn().mockReturnValue({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext);

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RolesGuard, Reflector],
    }).compile();

    guard = module.get<RolesGuard>(RolesGuard);
    reflector = module.get<Reflector>(Reflector);
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('should allow access when no roles are required', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);

    const context = mockExecutionContext({ id: '1', role: Role.VIEWER });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('should allow access when user has required role', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.PM]);

    const context = mockExecutionContext({ id: '1', role: Role.PM });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('should allow ADMIN access to any role-protected route', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.QA]);

    const context = mockExecutionContext({ id: '1', role: Role.ADMIN });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('should deny access when user lacks required role', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.ADMIN]);

    const context = mockExecutionContext({ id: '1', role: Role.VIEWER });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('should throw when no user on request', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.PM]);

    const context = mockExecutionContext(undefined);
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
```

---

### E2E Test: Authentication Flow

**File:** `test/auth.e2e-spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { AppModule } from '../src/app.module';
import { Role } from '../src/auth/constants/roles.enum';

describe('Authentication (e2e)', () => {
  let app: INestApplication;
  let jwtService: JwtService;

  const createToken = (payload: any): string => {
    return jwtService.sign(payload);
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());
    await app.init();

    jwtService = moduleFixture.get<JwtService>(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Public endpoints', () => {
    it('GET / should be accessible without token', () => {
      return request(app.getHttpServer())
        .get('/')
        .expect(200);
    });

    it('GET /health should be accessible without token', () => {
      return request(app.getHttpServer())
        .get('/health')
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('status');
          expect(res.body).toHaveProperty('services');
        });
    });
  });

  describe('Protected endpoints', () => {
    it('GET /profile should return 401 without token', () => {
      return request(app.getHttpServer())
        .get('/profile')
        .expect(401)
        .expect((res) => {
          expect(res.body.message).toContain('Authentication required');
        });
    });

    it('GET /profile should return 401 with invalid token', () => {
      return request(app.getHttpServer())
        .get('/profile')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);
    });

    it('GET /profile should return 401 with expired token', () => {
      const expiredToken = jwtService.sign(
        { sub: 'user-1', role: Role.PM, email: 'test@test.com', name: 'Test' },
        { expiresIn: '-1h' },
      );

      return request(app.getHttpServer())
        .get('/profile')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(401)
        .expect((res) => {
          expect(res.body.message).toContain('expired');
        });
    });

    it('GET /profile should return user with valid token', () => {
      const token = createToken({
        sub: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        role: Role.PM,
      });

      return request(app.getHttpServer())
        .get('/profile')
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.id).toBe('user-123');
          expect(res.body.email).toBe('test@example.com');
          expect(res.body.role).toBe(Role.PM);
        });
    });
  });

  describe('Role-based access', () => {
    it('GET /admin/stats should return 403 for VIEWER role', () => {
      const token = createToken({
        sub: 'user-1',
        email: 'viewer@test.com',
        name: 'Viewer',
        role: Role.VIEWER,
      });

      return request(app.getHttpServer())
        .get('/admin/stats')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    });

    it('GET /admin/stats should return 200 for ADMIN role', () => {
      const token = createToken({
        sub: 'user-1',
        email: 'admin@test.com',
        name: 'Admin',
        role: Role.ADMIN,
      });

      return request(app.getHttpServer())
        .get('/admin/stats')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    });

    it('GET /admin/stats should return 200 for MANAGER role', () => {
      const token = createToken({
        sub: 'user-1',
        email: 'manager@test.com',
        name: 'Manager',
        role: Role.MANAGER,
      });

      return request(app.getHttpServer())
        .get('/admin/stats')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    });
  });
});
```

---

## Usage Examples

### Example 1: Protecting a Controller with Default Authentication

```typescript
import { Controller, Get, Post, Body } from '@nestjs/common';
import { CurrentUser, Roles } from '../common/decorators';
import { RolesGuard } from '../common/guards';
import { UseGuards } from '@nestjs/common';
import { Role } from '../auth/constants/roles.enum';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';

@Controller('tickets')
export class TicketsController {
  // All routes in this controller require authentication (global guard)
  
  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    // User is always available here
    console.log(`User ${user.id} fetching tickets`);
    return this.ticketsService.findByUser(user.id);
  }

  @UseGuards(RolesGuard)
  @Roles(Role.PM, Role.ADMIN)
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateTicketDto) {
    // Only PM and ADMIN can create tickets
    return this.ticketsService.create(dto, user.id);
  }
}
```

### Example 2: Mixing Public and Protected Routes

```typescript
import { Controller, Get, Post } from '@nestjs/common';
import { Public, CurrentUser } from '../common/decorators';

@Controller('api')
export class ApiController {
  @Public()
  @Get('status')
  getStatus() {
    // No authentication required
    return { status: 'ok' };
  }

  @Get('me')
  getMe(@CurrentUser() user: AuthenticatedUser) {
    // Authentication required (global guard)
    return user;
  }
}
```

### Example 3: Fine-Grained Permission Control

```typescript
import { Controller, Post, UseGuards } from '@nestjs/common';
import { RequirePermissions } from '../common/decorators';
import { PermissionsGuard, JwtAuthGuard } from '../common/guards';
import { Permission } from '../auth/constants/roles.enum';

@Controller('architecture')
export class ArchitectureController {
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.REVIEW_ARCHITECTURE)
  @Post('review')
  submitReview() {
    // Only users with REVIEW_ARCHITECTURE permission can access
    return { message: 'Review submitted' };
  }
}
```

---

## Validation Checklist

Before marking this story as complete, verify:

**Installation & Setup:**
- [ ] `@nestjs/jwt` installed as dependency
- [ ] `@nestjs/passport` installed as dependency
- [ ] `passport` installed as dependency
- [ ] `passport-jwt` installed as dependency
- [ ] `@types/passport-jwt` installed as devDependency

**Roles & Permissions:**
- [ ] `src/auth/constants/roles.enum.ts` created with 6 roles
- [ ] Permission enum includes all required permissions
- [ ] ROLE_PERMISSIONS matrix matches architecture.md

**JWT Strategy:**
- [ ] `src/auth/strategies/jwt.strategy.ts` created
- [ ] Validates JWT using shared secret from config
- [ ] Extracts user claims correctly
- [ ] Returns AuthenticatedUser object
- [ ] Throws UnauthorizedException for invalid tokens

**Guards:**
- [ ] `src/common/guards/auth.guard.ts` created (JwtAuthGuard)
- [ ] `src/common/guards/roles.guard.ts` created
- [ ] `src/common/guards/permissions.guard.ts` created (optional)
- [ ] Guards index file exports all guards

**Decorators:**
- [ ] `@Public()` decorator marks routes as public
- [ ] `@Roles()` decorator specifies required roles
- [ ] `@RequirePermissions()` decorator specifies required permissions
- [ ] `@CurrentUser()` decorator extracts user from request
- [ ] Decorators index file exports all decorators

**Module Configuration:**
- [ ] `AuthModule` imports PassportModule and JwtModule
- [ ] `AuthModule` provides JwtStrategy
- [ ] `AuthModule` exports PassportModule and JwtModule
- [ ] `AppModule` imports AuthModule
- [ ] JwtAuthGuard registered as global guard

**Authentication Behavior:**
- [ ] Protected routes return 401 without token
- [ ] Protected routes return 401 with invalid token
- [ ] Protected routes return 401 with expired token
- [ ] Protected routes return 200 with valid token
- [ ] Token expiration is validated correctly

**Authorization Behavior:**
- [ ] ADMIN role has access to all protected routes
- [ ] Role-specific routes deny access to unauthorized roles
- [ ] Missing roles return 403 Forbidden
- [ ] @Public() routes bypass authentication

**Public Routes:**
- [ ] GET `/` is accessible without token
- [ ] GET `/health` is accessible without token
- [ ] No other routes are accidentally public

**Testing:**
- [ ] `src/auth/strategies/jwt.strategy.spec.ts` passes
- [ ] `src/common/guards/roles.guard.spec.ts` passes
- [ ] `test/auth.e2e-spec.ts` E2E tests pass
- [ ] `npm run test` passes with auth tests
- [ ] `npm run test:e2e` passes with auth tests

**Code Quality:**
- [ ] `npm run lint` shows no linting errors
- [ ] Prettier formatting applied to all new files
- [ ] TypeScript compiles without errors

**Version Control:**
- [ ] All new files committed
- [ ] `package.json` changes committed (new dependencies)
- [ ] Commit message: `feat: add JWT authentication with RBAC`

---

## Common Pitfalls to Avoid

**JWT Strategy:**
- ❌ **Don't** hardcode JWT secret - use ConfigService
- ❌ **Don't** skip algorithm validation - specify allowed algorithms
- ❌ **Don't** allow expired tokens - set `ignoreExpiration: false`

**Guards:**
- ❌ **Don't** forget to apply RolesGuard with JwtAuthGuard - RolesGuard needs user
- ❌ **Don't** mix guard order - JwtAuthGuard must run before RolesGuard
- ❌ **Don't** forget @Public() on health check - monitoring needs access

**Roles:**
- ❌ **Don't** forget ADMIN bypass - ADMIN should have full access
- ❌ **Don't** use string comparisons for roles - use enum values
- ❌ **Don't** forget to validate role exists in JWT payload

**Testing:**
- ❌ **Don't** use production JWT secret in tests
- ❌ **Don't** skip expired token testing - critical for security
- ❌ **Don't** forget to test 403 vs 401 responses

---

## Expected Configuration After Completion

**File Structure:**
```
src/
├── auth/
│   ├── auth.module.ts            ✅ Updated
│   ├── constants/
│   │   └── roles.enum.ts         ✅ New
│   ├── interfaces/
│   │   └── jwt-payload.interface.ts  ✅ New
│   └── strategies/
│       ├── jwt.strategy.ts       ✅ New
│       └── jwt.strategy.spec.ts  ✅ New
├── common/
│   ├── decorators/
│   │   ├── index.ts              ✅ New
│   │   ├── current-user.decorator.ts  ✅ New
│   │   ├── public.decorator.ts   ✅ New
│   │   ├── roles.decorator.ts    ✅ New
│   │   └── permissions.decorator.ts  ✅ New
│   └── guards/
│       ├── index.ts              ✅ New
│       ├── auth.guard.ts         ✅ New
│       ├── roles.guard.ts        ✅ New
│       ├── roles.guard.spec.ts   ✅ New
│       └── permissions.guard.ts  ✅ New
└── app.module.ts                 ✅ Updated (global guard)

test/
└── auth.e2e-spec.ts              ✅ New
```

**Application Behavior:**
```
✅ All routes protected by default
✅ @Public() routes bypass authentication
✅ JWT tokens validated on each request
✅ User extracted and available via @CurrentUser()
✅ Role-based access enforced with RolesGuard
✅ Permission-based access available with PermissionsGuard
✅ 401 Unauthorized for missing/invalid/expired tokens
✅ 403 Forbidden for insufficient permissions
```

---

## References

### Source Documents

1. **[Architecture - Security Architecture]** (`docs/architecture.md` - Lines 1973-2056)
   - Authentication Flow (7 steps)
   - Authorization (RBAC) with 6 roles
   - Permission Matrix
   - API Security requirements

2. **[Architecture - Project Structure]** (`docs/architecture.md` - Lines 95-100)
   - Auth module location: `src/auth/`
   - Guards location: `src/common/guards/`
   - Decorators location: `src/common/decorators/`

3. **[Epics - Story 1.6]** (`docs/epics.md` - Lines 421-461)
   - Acceptance criteria
   - Technical notes with specific packages
   - Role definitions

4. **[PRD - Security Requirements]** (NFR-S1, NFR-S2)
   - NFR-S1: Authentication required for all non-public endpoints
   - NFR-S2: RBAC with defined role permissions

---

## Prerequisites

**Required:**
- ✅ Story 1.1 Complete - NestJS project initialized
- ✅ Story 1.4 Complete - Environment configuration with JWT_SECRET

**Verify JWT_SECRET configured:**
```bash
grep JWT_SECRET .env
# Should show: JWT_SECRET=your-super-secret-jwt-key-change-me-in-production
```

**Story Dependencies:** Story 1.1 (NestJS Project), Story 1.4 (Environment Configuration)

---

## Implementation Notes

### Critical Architecture Clarification: External User Management

**⚠️ IMPORTANT:** This orchestrator does **NOT** manage users locally.

Per architecture.md "Separate Auth Service - JWT-based":
- **Users are managed by an EXTERNAL auth service** (e.g., AetherFlow's auth, Auth0, Keycloak)
- The orchestrator **only validates JWTs** - it does not store user data
- The Prisma schema has NO `User` model intentionally
- `AuditLog.actor_id` references the **external user ID** from the JWT `sub` claim
- Token issuance and refresh are handled by the external auth service

**What this means for implementation:**
- Do NOT create a User model in Prisma
- Do NOT implement login/register endpoints
- The JwtStrategy validates tokens using the shared `JWT_SECRET`
- User information comes entirely from the JWT payload claims

### Future Integration: Swagger API Documentation (Story 1.12)

When Story 1.12 is implemented, protected routes will need `@ApiBearerAuth()` decorator for Swagger UI:

```typescript
// After Story 1.12 - Add to protected controllers:
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

@ApiBearerAuth()  // Enables "Authorize" button in Swagger UI
@ApiTags('tickets')
@Controller('tickets')
export class TicketsController { }
```

**Preparation:** The auth infrastructure created in this story enables Story 1.12's "Configure JWT bearer auth in Swagger UI" requirement.

### Critical Success Factors

1. **Global Guard by Default:** Using `APP_GUARD` ensures all routes are protected unless explicitly marked `@Public()`. This is security-first approach.

2. **ADMIN Bypass:** ADMIN role should always have access. This simplifies administration and prevents lockouts.

3. **Separation of Concerns:** JwtAuthGuard handles authentication, RolesGuard handles authorization. Don't mix these concerns.

4. **Type Safety:** Use TypeScript interfaces for JWT payloads and user objects. This catches errors at compile time.

5. **No Local User Storage:** Remember - users exist in the external auth service only. The orchestrator validates tokens, not users.

### Architecture Alignment

This story implements:
- **[Architecture: Separate Auth Service]** - JWT validation (auth service issues tokens)
- **[Architecture: Authentication Flow]** - Complete 7-step flow
- **[Architecture: RBAC]** - 6 roles with permission matrix
- **[NFR-S1]** - All endpoints secured by default
- **[NFR-S2]** - Role-based access control

### Preparation for Future Stories

This authentication foundation enables:
- **Story 2.1:** Webhook endpoint security (signature + auth)
- **Story 5.1-5.10:** Dashboard access control by role
- **Story 7.2-7.4:** TL architecture review (requires TL role)
- **Story 8.1-8.6:** QA approval workflow (requires QA role)
- **All API Stories:** Consistent authentication across codebase

---

## Dev Agent Record

### Context Reference

This story was prepared with complete context analysis from:
- Architecture document (Security Architecture, Lines 1973-2056)
- Architecture patterns (Authentication Flow, RBAC Matrix)
- Epic 1 goals (establish secure authentication foundation)
- PRD security requirements (NFR-S1, NFR-S2)
- NestJS Passport best practices
- Previous stories (1-4, 1-5) for JWT_SECRET availability

### Completion Notes

**Story Status:** Ready for developer implementation  
**Context Completeness:** ✅ COMPREHENSIVE  
**Developer Readiness:** ✅ FLAWLESS IMPLEMENTATION GUIDE CREATED

**Workflow After Story Completion:**
1. **Before Starting:** Update `sprint-status.yaml` → `1-6-jwt-authentication-service-integration: in-progress`
2. **Implementation:** Follow Steps 1-12 to set up complete authentication system
3. **Validation:** Complete all items in Validation Checklist (45 items)
4. **Version Control:** Commit with message `feat: add JWT authentication with RBAC`
5. **Status Update:** Update `sprint-status.yaml` → `1-6-jwt-authentication-service-integration: review`
6. **Code Review:** Request review from Scrum Master via code-review workflow

---

**Document prepared by:** Bob (Scrum Master)  
**Preparation date:** 2025-11-28  
**Analysis method:** Ultimate BMad Method Story Context Engine  
**Quality level:** Developer-ready with zero ambiguity

