# Story 1.12: API Documentation with Swagger/OpenAPI

**Epic:** 1 - Foundation & Development Environment  
**Status:** ready-for-dev  
**Priority:** P2 - MEDIUM (Improves developer experience)  
**Effort:** 3 story points  
**ClickUp ID:** `86evnjw8y`  
**ClickUp URL:** https://app.clickup.com/t/86evnjw8y

---

## ⚠️ CRITICAL ARCHITECTURE NOTES

**Current State:**
- NestJS 11.x with **Fastify adapter** (NOT Express)
- JWT authentication via `@nestjs/passport` + `passport-jwt`
- Role-based access control with `@Roles()` decorator
- Public routes marked with `@Public()` decorator
- Roles defined: `ADMIN`, `MANAGER`, `PM`, `TL`, `QA`, `VIEWER` (uppercase, see `src/auth/constants/roles.enum.ts`)
- No DTOs implemented yet (plain object returns)
- **NO** Swagger/OpenAPI installed

**This Story Creates:**
1. `@nestjs/swagger` integration with Fastify adapter
2. Swagger UI at `/api/docs` (dev/staging only - **disabled in production**)
3. OpenAPI 3.0 JSON spec at `/api/docs-json`
4. JWT Bearer authentication in Swagger UI
5. API decorators on existing endpoints
6. Response DTOs with `@ApiProperty()` decorators
7. Error response DTOs for 401/403

**Architecture Reference:** Section "API Documentation" in architecture.md

**Dependency Note:** DTOs with validation rules (e.g., `@IsString()`, `@IsEmail()`) require `class-validator` + `class-transformer` packages. These will be added in Story 1.13 or a dedicated validation story.

---

## Story

As a developer,
I want automatic API documentation with Swagger,
So that frontend developers and integrators can understand endpoints easily.

---

## Acceptance Criteria

**Given** API endpoints are implemented  
**When** I access `/api/docs` in development/staging  
**Then** Swagger UI displays complete API documentation:
- All endpoints grouped by module/tag
- Request/response schemas with examples
- Authentication requirements (JWT bearer token)
- HTTP status codes with descriptions
- Error response schemas for 401/403

**And** documentation is auto-generated from code decorators  
**And** OpenAPI 3.0 JSON spec is available at `/api/docs-json`  
**And** Try-it-out feature works with JWT authentication  
**And** examples show realistic sample data  
**And** Swagger is **disabled in production** (security requirement)

---

## Technical Requirements

### Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `package.json` | MODIFY | Add `@nestjs/swagger` dependency |
| `src/main.ts` | MODIFY | Configure Swagger with Fastify (env-based) |
| `src/app.controller.ts` | MODIFY | Add API decorators |
| `src/common/dto/health-response.dto.ts` | CREATE | Health endpoint DTO |
| `src/common/dto/profile-response.dto.ts` | CREATE | Profile endpoint DTO |
| `src/common/dto/admin-stats-response.dto.ts` | CREATE | Admin stats DTO |
| `src/common/dto/error-response.dto.ts` | CREATE | Error DTOs (401/403) |
| `src/common/dto/index.ts` | CREATE | Barrel export |
| `src/app.controller.spec.ts` | MODIFY | Add Swagger tests |

---

### Step 1: Install Dependencies

```bash
pnpm add @nestjs/swagger
```

**Note:** NestJS 11's `@nestjs/swagger` has built-in Fastify support. Additional packages (`@fastify/swagger`, `@fastify/swagger-ui`) are NOT required.

---

### Step 2: Configure Swagger in main.ts (Environment-Based)

**File:** `src/main.ts`

```typescript
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: true }),
  );

  // Only enable Swagger in non-production environments
  const isProduction = process.env.NODE_ENV === 'production';
  
  if (!isProduction) {
    const config = new DocumentBuilder()
      .setTitle('Dark Software Factory API')
      .setDescription(
        'AI Dev Tool Orchestrator API - Automates the pipeline from PM tickets to deployed code.\n\n' +
        '## Authentication\n' +
        'Most endpoints require JWT Bearer authentication. Use the Authorize button to set your token.\n\n' +
        '## Roles\n' +
        'Valid roles: `ADMIN`, `MANAGER`, `PM`, `TL`, `QA`, `VIEWER`',
      )
      .setVersion('1.0.0')
      .setContact('Dark Software Factory Team', 'https://github.com/alpharages/dark-software-factory', 'support@alpharages.com')
      .addServer('http://localhost:3000', 'Development')
      .addServer('https://staging.darksoftwarefactory.com', 'Staging')
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Enter JWT token' },
        'JWT-auth',
      )
      .addTag('Health', 'System health and status endpoints')
      .addTag('Auth', 'Authentication and user profile endpoints')
      .addTag('Admin', 'Administrative endpoints (elevated permissions required)')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    
    await SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
        tagsSorter: 'alpha',
        operationsSorter: 'alpha',
        docExpansion: 'list',
        filter: true,
        showRequestDuration: true,
      },
      customSiteTitle: 'Dark Software Factory API',
    });

    console.log(`Swagger docs available at: http://localhost:3000/api/docs`);
  }

  await app.listen(3000, '0.0.0.0');
  console.log(`Application is running on: ${await app.getUrl()}`);
}
bootstrap();
```

**Security:** Swagger is disabled when `NODE_ENV=production`.

---

### Step 3: Create Response DTOs

**File:** `src/common/dto/health-response.dto.ts`

```typescript
import { ApiProperty } from '@nestjs/swagger';

export class ServiceStatusDto {
  @ApiProperty({ example: 'up', enum: ['up', 'down'] })
  database: 'up' | 'down';

  @ApiProperty({ example: 'up', enum: ['up', 'down'] })
  rabbitmq: 'up' | 'down';
}

export class HealthResponseDto {
  @ApiProperty({ example: 'healthy', enum: ['healthy', 'unhealthy'] })
  status: 'healthy' | 'unhealthy';

  @ApiProperty({ example: '2025-12-01T10:30:00.000Z' })
  timestamp: string;

  @ApiProperty({ type: ServiceStatusDto })
  services: ServiceStatusDto;
}
```

**File:** `src/common/dto/profile-response.dto.ts`

```typescript
import { ApiProperty } from '@nestjs/swagger';

export class ProfileResponseDto {
  @ApiProperty({ example: 'usr_abc123' })
  id: string;

  @ApiProperty({ example: 'developer@alpharages.com' })
  email: string;

  @ApiProperty({ example: 'Jane Developer' })
  name: string;

  @ApiProperty({ example: 'PM', enum: ['ADMIN', 'MANAGER', 'PM', 'TL', 'QA', 'VIEWER'] })
  role: string;
}
```

**File:** `src/common/dto/admin-stats-response.dto.ts`

```typescript
import { ApiProperty } from '@nestjs/swagger';

export class AdminStatsResponseDto {
  @ApiProperty({ example: 'Admin only stats' })
  message: string;

  @ApiProperty({ example: '2025-12-01T10:30:00.000Z' })
  timestamp: string;
}
```

**File:** `src/common/dto/error-response.dto.ts`

```typescript
import { ApiProperty } from '@nestjs/swagger';

export class UnauthorizedResponseDto {
  @ApiProperty({ example: 401 })
  statusCode: number;

  @ApiProperty({ example: 'Unauthorized' })
  message: string;
}

export class ForbiddenResponseDto {
  @ApiProperty({ example: 403 })
  statusCode: number;

  @ApiProperty({ example: 'Forbidden resource' })
  message: string;

  @ApiProperty({ example: 'Forbidden' })
  error: string;
}
```

**File:** `src/common/dto/index.ts`

```typescript
export * from './health-response.dto';
export * from './profile-response.dto';
export * from './admin-stats-response.dto';
export * from './error-response.dto';
```

---

### Step 4: Add Swagger Decorators to Controller

**File:** `src/app.controller.ts`

```typescript
import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
} from '@nestjs/swagger';
import { AppService } from './app.service';
import { PrismaService } from './database/prisma.service';
import { RabbitMQService } from './rabbitmq/rabbitmq.service';
import { Public, CurrentUser, Roles } from './common/decorators';
import { RolesGuard } from './common/guards';
import { AuthenticatedUser } from './auth/interfaces/jwt-payload.interface';
import { Role } from './auth/constants/roles.enum';
import {
  HealthResponseDto,
  ProfileResponseDto,
  AdminStatsResponseDto,
  UnauthorizedResponseDto,
  ForbiddenResponseDto,
} from './common/dto';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly prismaService: PrismaService,
    private readonly rabbitMQService: RabbitMQService,
  ) {}

  @ApiTags('Health')
  @ApiOperation({ summary: 'Root endpoint' })
  @ApiResponse({ status: 200, schema: { type: 'string', example: 'Hello World!' } })
  @Public()
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @ApiTags('Health')
  @ApiOperation({ summary: 'Health check', description: 'Returns health status of database and RabbitMQ' })
  @ApiResponse({ status: 200, type: HealthResponseDto })
  @Public()
  @Get('health')
  async getHealth(): Promise<HealthResponseDto> {
    const dbHealthy = await this.checkDatabaseHealth();
    let rabbitMQHealthy = false;
    try {
      rabbitMQHealthy = await this.rabbitMQService.isHealthy();
    } catch {
      rabbitMQHealthy = false;
    }

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

  @ApiTags('Auth')
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiBearerAuth('JWT-auth')
  @ApiResponse({ status: 200, type: ProfileResponseDto })
  @ApiUnauthorizedResponse({ type: UnauthorizedResponseDto })
  @Get('profile')
  getProfile(@CurrentUser() user: AuthenticatedUser): ProfileResponseDto {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    };
  }

  @ApiTags('Admin')
  @ApiOperation({ summary: 'Get admin statistics', description: 'Requires ADMIN or MANAGER role' })
  @ApiBearerAuth('JWT-auth')
  @ApiResponse({ status: 200, type: AdminStatsResponseDto })
  @ApiUnauthorizedResponse({ type: UnauthorizedResponseDto })
  @ApiForbiddenResponse({ type: ForbiddenResponseDto })
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN, Role.MANAGER)
  @Get('admin/stats')
  getAdminStats(): AdminStatsResponseDto {
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

### Step 5: Add Unit Test for Swagger

**Add to:** `src/app.controller.spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

describe('Swagger Configuration', () => {
  let module: TestingModule;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
  });

  afterAll(async () => {
    await module.close();
  });

  it('should generate valid OpenAPI document', () => {
    const app = module.createNestApplication();
    
    const config = new DocumentBuilder()
      .setTitle('Test API')
      .setVersion('1.0')
      .addBearerAuth({}, 'JWT-auth')
      .build();

    const document = SwaggerModule.createDocument(app, config);

    expect(document).toBeDefined();
    expect(document.openapi).toBe('3.0.0');
    expect(document.info.title).toBe('Test API');
    expect(document.paths).toBeDefined();
  });

  it('should include JWT security scheme', () => {
    const app = module.createNestApplication();
    
    const config = new DocumentBuilder()
      .setTitle('Test API')
      .setVersion('1.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer' }, 'JWT-auth')
      .build();

    const document = SwaggerModule.createDocument(app, config);

    expect(document.components?.securitySchemes?.['JWT-auth']).toBeDefined();
  });
});
```

---

### Step 6: Verify Installation

```bash
# Install the dependency
pnpm add @nestjs/swagger

# Generate Prisma client
pnpm exec prisma generate

# Run tests
pnpm run test

# Start development server
pnpm run start:dev

# Open Swagger UI
open http://localhost:3000/api/docs
```

**Expected Results:**
1. Swagger UI loads at `/api/docs`
2. Three tags visible: Health, Auth, Admin
3. JWT Authorization button works
4. Error responses (401/403) documented
5. `/api/docs-json` returns OpenAPI 3.0 JSON
6. Tests pass

---

## Tasks / Subtasks

- [ ] **Task 1: Install Dependency** (AC: prerequisite)
  - [ ] Run `pnpm add @nestjs/swagger`
  - [ ] Verify in `package.json`

- [ ] **Task 2: Configure Swagger in main.ts** (AC: #1, #2, security)
  - [ ] Add environment check (`NODE_ENV !== 'production'`)
  - [ ] Configure DocumentBuilder with title, description, auth
  - [ ] Setup Swagger UI at `/api/docs`

- [ ] **Task 3: Create Response DTOs** (AC: #3)
  - [ ] Create `src/common/dto/health-response.dto.ts` with exported ServiceStatusDto
  - [ ] Create `src/common/dto/profile-response.dto.ts` with correct Role enum values
  - [ ] Create `src/common/dto/admin-stats-response.dto.ts`
  - [ ] Create `src/common/dto/error-response.dto.ts` (401/403)
  - [ ] Create `src/common/dto/index.ts` barrel export

- [ ] **Task 4: Add Swagger Decorators** (AC: #1, #4)
  - [ ] Add `@ApiTags()`, `@ApiOperation()`, `@ApiResponse()`
  - [ ] Add `@ApiBearerAuth()` for protected routes
  - [ ] Add `@ApiUnauthorizedResponse()` and `@ApiForbiddenResponse()`

- [ ] **Task 5: Add Unit Tests** (AC: quality)
  - [ ] Add Swagger document generation test
  - [ ] Add JWT security scheme test
  - [ ] Run `pnpm run test`

- [ ] **Task 6: Verify** (AC: all)
  - [ ] Start server: `pnpm run start:dev`
  - [ ] Access: `http://localhost:3000/api/docs`
  - [ ] Verify all endpoints and error schemas
  - [ ] Test JWT auth in Swagger UI

---

## Dev Notes

### Role Values (CRITICAL)
Use **UPPERCASE** values matching `src/auth/constants/roles.enum.ts`:
- `ADMIN`, `MANAGER`, `PM`, `TL`, `QA`, `VIEWER`

**NOT:** `admin`, `developer`, `qa` (these are wrong)

### Security: Production Disabled
Swagger is disabled when `NODE_ENV=production`. This prevents:
- API schema exposure to attackers
- Endpoint discovery vulnerabilities
- Security audit flags

### JWT Testing in Swagger
1. Click **Authorize** button (🔒)
2. Enter JWT token (without "Bearer " prefix)
3. Click **Authorize** → protected endpoints now include token

**Generate test token:**
```bash
node -e "console.log(require('jsonwebtoken').sign({id:'test',email:'test@test.com',name:'Test',role:'ADMIN'}, process.env.JWT_SECRET || 'your-secret', {expiresIn:'1h'}))"
```

### Future Module Pattern
```typescript
@ApiTags('Ticket Intake')
@Controller('tickets')
export class TicketIntakeController {
  @ApiOperation({ summary: 'Create ticket' })
  @ApiResponse({ status: 201, type: TicketResponseDto })
  @Post()
  create(@Body() dto: CreateTicketDto) { /* ... */ }
}
```

### Existing Patterns

| Pattern | Location |
|---------|----------|
| `@Public()` | `src/common/decorators/public.decorator.ts` |
| `@Roles()` | `src/common/decorators/roles.decorator.ts` |
| `@CurrentUser()` | `src/common/decorators/current-user.decorator.ts` |
| `Role` enum | `src/auth/constants/roles.enum.ts` |

---

## References

- [Source: docs/architecture.md#API Documentation]
- [Source: docs/epics.md#Story 1.12]
- [Source: src/auth/constants/roles.enum.ts]
- [NestJS Swagger](https://docs.nestjs.com/openapi/introduction)
- [OpenAPI 3.0 Spec](https://swagger.io/specification/)

---

## Dev Agent Record

### Context Reference

### Agent Model Used

### Completion Notes List

### File List
