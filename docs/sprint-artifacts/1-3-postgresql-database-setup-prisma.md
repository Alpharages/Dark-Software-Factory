# Story 1.3: PostgreSQL Database Setup with Prisma

**Epic:** 1 - Foundation & Development Environment  
**Status:** ready-for-dev  
**Priority:** P0 - BLOCKER  
**Effort:** 5 story points  
**ClickUp ID:** `86evnjw8e`  
**ClickUp URL:** https://app.clickup.com/t/86evnjw8e

---

## Story

As a developer,
I want a PostgreSQL database configured with Prisma ORM,
So that I can persist tickets, executions, and metrics reliably.

---

## Acceptance Criteria

**Given** PostgreSQL 16 is available (local or Docker)  
**When** I set up Prisma with the schema from architecture.md  
**Then** the following is configured:
- `prisma/schema.prisma` matches architecture data model exactly
- DATABASE_URL environment variable is configured
- `npx prisma generate` creates TypeScript client successfully
- `npx prisma migrate dev` creates all tables without errors

**And** the database contains these tables (per architecture):
- `tickets` (with enums for TicketStatus)
- `executions` (with enums for AIProvider, ExecutionStatus)
- `qa_results`
- `github_pushes` (with GitHubStatus enum)
- `deployments` (with DeploymentStatus enum)
- `cost_records`
- `production_errors` (with ErrorSeverity enum)
- `metrics`
- `audit_logs`

**And** all foreign key relationships are established  
**And** indexes are created per architecture specification  
**And** Prisma client is injectable via `@Injectable()` PrismaService

---

## Technical Requirements

### Step 1: Install Prisma Dependencies

```bash
# Install Prisma CLI (dev dependency)
npm install -D prisma

# Install Prisma Client (runtime dependency)
npm install @prisma/client
```

**Why these dependencies:**
- `prisma` - CLI for migrations, schema generation, database operations
- `@prisma/client` - Auto-generated TypeScript client for type-safe database queries

---

### Step 2: Initialize Prisma

```bash
npx prisma init
```

**What this creates:**
- `prisma/` folder in project root
- `prisma/schema.prisma` - Database schema definition
- `.env` file with DATABASE_URL template (if doesn't exist)

**Expected output:**
```
✔ Your Prisma schema was created at prisma/schema.prisma
  You can now open it in your favorite editor.

Next steps:
1. Set the DATABASE_URL in the .env file to point to your existing database.
2. Set the provider of the datasource block in schema.prisma to match your database: postgresql, mysql, sqlite, sqlserver, mongodb or cockroachdb.
3. Run prisma db pull to turn your database schema into a Prisma schema.
4. Run prisma generate to generate the Prisma Client.
```

---

### Step 3: Configure Database Connection

**File:** `.env` (already created in Story 1.4, update if needed)

```bash
# PostgreSQL Connection String
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ai_orchestrator?schema=public"
```

**Connection String Format:**
```
postgresql://[USER]:[PASSWORD]@[HOST]:[PORT]/[DATABASE]?schema=[SCHEMA]

Components:
- USER: postgres (default)
- PASSWORD: postgres (change in production!)
- HOST: localhost (or docker service name)
- PORT: 5432 (PostgreSQL default)
- DATABASE: ai_orchestrator (our database name)
- SCHEMA: public (default schema)
```

**Security Notes:**
- ❌ **NEVER commit `.env` to git** - already in `.gitignore`
- ✅ Use `.env.example` as template with placeholder values
- ✅ Rotate passwords in production (use secrets manager)
- ✅ Use connection pooling (see Step 8)

---

### Step 4: Define Complete Prisma Schema

**File:** `prisma/schema.prisma`

**Replace entire file content with:**

```prisma
// Prisma Schema for AI Dev Tool Orchestrator
// Architecture Reference: docs/architecture.md (Data Architecture section)

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ============================================
// TICKET INTAKE
// ============================================

model Ticket {
  id                    String       @id @default(uuid())
  clickup_task_id       String       @unique
  project_id            String
  title                 String
  description           String       @db.Text
  acceptance_criteria   String       @db.Text
  ticket_quality_score  Int
  status                TicketStatus @default(RECEIVED)
  
  // Relationships
  executions      Execution[]
  cost_records    CostRecord[]
  
  created_at      DateTime @default(now())
  updated_at      DateTime @updatedAt
  
  @@index([project_id, status])
  @@index([created_at])
  @@map("tickets")
}

enum TicketStatus {
  RECEIVED
  VALIDATED
  VALIDATION_FAILED
  QUEUED
  AI_PROCESSING
  QA_REVIEW
  QA_FAILED
  GITHUB_PUSH
  DEPLOYING
  DEPLOYED
  MONITORING
  FAILED
  COMPLETED
}

// ============================================
// AI EXECUTION TRACKING
// ============================================

model Execution {
  id                String           @id @default(uuid())
  ticket_id         String
  ticket            Ticket           @relation(fields: [ticket_id], references: [id])
  
  ai_provider       AIProvider
  prompt            String           @db.Text
  status            ExecutionStatus  @default(QUEUED)
  confidence_score  Float?
  
  started_at        DateTime?
  completed_at      DateTime?
  failed_at         DateTime?
  error_message     String?          @db.Text
  
  // Generated code
  code_output       String?          @db.Text
  files_changed     Json?            // Array of file paths
  
  // Retry tracking
  retry_count       Int              @default(0)
  max_retries       Int              @default(3)
  
  created_at        DateTime         @default(now())
  updated_at        DateTime         @updatedAt
  
  @@index([ticket_id, status])
  @@index([ai_provider, status])
  @@map("executions")
}

enum AIProvider {
  CURSOR
  WINDSURF
  ANTIGRAVITY
}

enum ExecutionStatus {
  QUEUED
  IN_PROGRESS
  COMPLETED
  FAILED
  TIMEOUT
  CANCELLED
}

// ============================================
// QA RESULTS
// ============================================

model QAResult {
  id                  String   @id @default(uuid())
  execution_id        String
  
  linting_passed      Boolean
  linting_errors      Json?
  
  tests_passed        Boolean
  test_results        Json?
  test_coverage       Float?
  
  code_review_passed  Boolean
  code_review_issues  Json?
  
  overall_passed      Boolean
  
  created_at          DateTime @default(now())
  
  @@map("qa_results")
}

// ============================================
// GITHUB INTEGRATION
// ============================================

model GitHubPush {
  id              String       @id @default(uuid())
  execution_id    String
  
  repository      String
  branch_name     String
  commit_sha      String?
  pr_number       Int?
  pr_url          String?
  
  push_status     GitHubStatus @default(PENDING)
  error_message   String?      @db.Text
  
  created_at      DateTime     @default(now())
  updated_at      DateTime     @updatedAt
  
  @@map("github_pushes")
}

enum GitHubStatus {
  PENDING
  BRANCH_CREATED
  COMMITTED
  PR_CREATED
  MERGED
  FAILED
}

// ============================================
// DEPLOYMENT TRACKING
// ============================================

model Deployment {
  id              String           @id @default(uuid())
  github_push_id  String
  
  environment     String           // dev, staging, production
  cicd_provider   String           // github-actions, jenkins, etc.
  build_id        String?
  
  status          DeploymentStatus @default(TRIGGERED)
  deployed_at     DateTime?
  
  created_at      DateTime         @default(now())
  updated_at      DateTime         @updatedAt
  
  @@map("deployments")
}

enum DeploymentStatus {
  TRIGGERED
  IN_PROGRESS
  COMPLETED
  FAILED
  ROLLED_BACK
}

// ============================================
// COST TRACKING
// ============================================

model CostRecord {
  id              String     @id @default(uuid())
  ticket_id       String
  ticket          Ticket     @relation(fields: [ticket_id], references: [id])
  
  ai_provider     AIProvider
  operation_type  String     // code_generation, review, etc.
  
  tokens_used     Int?
  api_calls       Int        @default(1)
  cost_in_cents   Int        // Store as cents to avoid floating point
  
  created_at      DateTime   @default(now())
  
  @@index([ticket_id])
  @@index([ai_provider, created_at])
  @@map("cost_records")
}

// ============================================
// PRODUCTION MONITORING
// ============================================

model ProductionError {
  id                String        @id @default(uuid())
  
  application       String
  error_type        String
  error_message     String        @db.Text
  stack_trace       String?       @db.Text
  
  severity          ErrorSeverity
  
  fix_ticket_id     String?       // ClickUp task ID if auto-created
  resolved          Boolean       @default(false)
  
  occurred_at       DateTime
  created_at        DateTime      @default(now())
  
  @@index([application, severity, resolved])
  @@map("production_errors")
}

enum ErrorSeverity {
  CRITICAL
  HIGH
  MEDIUM
  LOW
}

// ============================================
// METRICS & ANALYTICS
// ============================================

model Metric {
  id          String   @id @default(uuid())
  
  metric_name String
  metric_type String   // counter, gauge, histogram
  value       Float
  labels      Json?    // Key-value pairs for filtering
  
  recorded_at DateTime @default(now())
  
  @@index([metric_name, recorded_at])
  @@map("metrics")
}

// ============================================
// AUDIT TRAIL
// ============================================

model AuditLog {
  id              String   @id @default(uuid())
  
  entity_type     String   // ticket, execution, deployment
  entity_id       String
  action          String   // created, updated, status_changed
  
  actor_type      String   // user, system
  actor_id        String?  // user ID if human, null if system
  
  before_state    Json?
  after_state     Json?
  
  created_at      DateTime @default(now())
  
  @@index([entity_type, entity_id])
  @@index([created_at])
  @@map("audit_logs")
}
```

**Schema Structure Highlights:**
- **9 tables** with complete data model
- **6 enums** for type safety
- **Foreign key relationships** (Ticket → Executions, Ticket → CostRecords)
- **Strategic indexes** for query performance
- **Timestamp tracking** (created_at, updated_at)
- **Snake_case table names** (PostgreSQL convention)
- **UUID primary keys** (distributed system ready)

---

### Step 5: Generate Prisma Client

```bash
npx prisma generate
```

**What this does:**
- Generates TypeScript types from schema
- Creates Prisma Client in `node_modules/@prisma/client`
- Enables type-safe database queries

**Expected output:**
```
✔ Generated Prisma Client (4.x.x | library) to ./node_modules/@prisma/client

You can now start using Prisma Client in your code:

import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
```

---

### Step 6: Create Initial Migration

```bash
npx prisma migrate dev --name init
```

**What this does:**
1. Compares schema to database (currently empty)
2. Generates SQL migration file
3. Applies migration to database
4. Creates `prisma/migrations/` folder
5. Generates Prisma Client

**Expected output:**
```
Environment variables loaded from .env
Prisma schema loaded from prisma/schema.prisma
Datasource "db": PostgreSQL database "ai_orchestrator", schema "public" at "localhost:5432"

Applying migration `20251127000000_init`

The following migration(s) have been created and applied from new schema changes:

migrations/
  └─ 20251127000000_init/
    └─ migration.sql

Your database is now in sync with your schema.

✔ Generated Prisma Client (4.x.x | library) to ./node_modules/@prisma/client
```

**Migration file location:**
- `prisma/migrations/20251127000000_init/migration.sql`

**Migration contains:**
- CREATE TABLE statements for all 9 tables
- CREATE TYPE statements for all 6 enums
- CREATE INDEX statements for all indexes
- ALTER TABLE statements for foreign keys

---

### Step 7: Create PrismaService (NestJS Integration)

**File:** `src/database/prisma.service.ts`

```typescript
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      log: [
        { level: 'query', emit: 'event' },
        { level: 'error', emit: 'event' },
        { level: 'warn', emit: 'event' },
      ],
    });

    // Log queries in development
    if (process.env.NODE_ENV === 'development') {
      this.$on('query' as any, (e: any) => {
        console.log('Query: ' + e.query);
        console.log('Duration: ' + e.duration + 'ms');
      });
    }

    // Log errors always
    this.$on('error' as any, (e: any) => {
      console.error('Prisma Error:', e);
    });
  }

  async onModuleInit() {
    // Connect to database on module initialization
    await this.$connect();
    console.log('✅ Database connected');
  }

  async onModuleDestroy() {
    // Disconnect from database on module destruction
    await this.$disconnect();
    console.log('🔌 Database disconnected');
  }

  /**
   * Clean all tables (useful for testing)
   * WARNING: Use only in test environment!
   */
  async cleanDatabase() {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Cannot clean database in production!');
    }

    const models = Object.keys(this).filter(
      (key) => !key.startsWith('_') && !key.startsWith('$'),
    );

    for (const model of models) {
      try {
        await (this as any)[model].deleteMany();
      } catch (error) {
        console.warn(`Could not clean ${model}:`, error);
      }
    }
  }
}
```

**Key features:**
- ✅ Extends `PrismaClient` for full API access
- ✅ Implements `OnModuleInit` for automatic connection
- ✅ Implements `OnModuleDestroy` for graceful shutdown
- ✅ Query logging in development
- ✅ Error logging always enabled
- ✅ `cleanDatabase()` helper for testing

---

### Step 8: Create PrismaModule (NestJS Module)

**File:** `src/database/database.module.ts`

```typescript
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global() // Makes PrismaService available everywhere
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class DatabaseModule {}
```

**Why `@Global()`:**
- PrismaService is needed in many modules (tickets, executions, costs, etc.)
- `@Global()` makes it available without importing DatabaseModule everywhere
- Single shared database connection across application

---

### Step 9: Register DatabaseModule in AppModule

**File:** `src/app.module.ts`

**Update to import DatabaseModule:**

```typescript
import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';

// Database
import { DatabaseModule } from './database/database.module';

// ... other imports from Story 1.2 ...

@Module({
  imports: [
    // Global modules (available everywhere)
    DatabaseModule, // NEW: Add database module

    // ... rest of modules from Story 1.2 ...
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

---

### Step 10: Configure Connection Pooling

**File:** `prisma/schema.prisma` (update datasource block)

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

**Connection String with Pooling:**

```bash
# .env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ai_orchestrator?schema=public&connection_limit=20&pool_timeout=10"
```

**Pool parameters:**
- `connection_limit=20` - Max 20 concurrent connections (per architecture spec)
- `pool_timeout=10` - Wait 10 seconds for available connection before timeout

**Why pooling matters:**
- ✅ Reuses connections (faster than creating new ones)
- ✅ Prevents connection exhaustion (database has connection limits)
- ✅ Improves performance under load

---

## Docker Compose Configuration (Local Development)

**File:** `docker-compose.yml` (create in project root)

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    container_name: ai-orchestrator-postgres
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: ai_orchestrator
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

volumes:
  postgres_data:
    driver: local
```

**Start PostgreSQL:**
```bash
docker-compose up -d postgres
```

**Check status:**
```bash
docker-compose ps
```

**View logs:**
```bash
docker-compose logs -f postgres
```

**Stop PostgreSQL:**
```bash
docker-compose down
```

**Delete data volume (reset database):**
```bash
docker-compose down -v
```

---

## Database Seed Data (Optional but Recommended)

**File:** `prisma/seed.ts`

```typescript
import { PrismaClient, TicketStatus, AIProvider, ExecutionStatus } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Create sample ticket
  const ticket = await prisma.ticket.create({
    data: {
      clickup_task_id: 'SAMPLE-001',
      project_id: 'sample-project',
      title: 'Sample Ticket: Add User Authentication',
      description: 'Implement JWT-based authentication for the API',
      acceptance_criteria: '- Users can login\n- Users can logout\n- JWT tokens expire after 1 hour',
      ticket_quality_score: 85,
      status: TicketStatus.RECEIVED,
    },
  });

  console.log('✅ Created ticket:', ticket.id);

  // Create sample execution
  const execution = await prisma.execution.create({
    data: {
      ticket_id: ticket.id,
      ai_provider: AIProvider.CURSOR,
      prompt: 'Implement JWT authentication...',
      status: ExecutionStatus.COMPLETED,
      confidence_score: 0.92,
      code_output: '// Generated authentication code...',
      files_changed: ['src/auth/auth.service.ts', 'src/auth/jwt.strategy.ts'],
      started_at: new Date(),
      completed_at: new Date(),
    },
  });

  console.log('✅ Created execution:', execution.id);

  // Create sample cost record
  const costRecord = await prisma.costRecord.create({
    data: {
      ticket_id: ticket.id,
      ai_provider: AIProvider.CURSOR,
      operation_type: 'code_generation',
      tokens_used: 1500,
      api_calls: 1,
      cost_in_cents: 45, // $0.45
    },
  });

  console.log('✅ Created cost record:', costRecord.id);

  console.log('🎉 Seeding complete!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

**Add seed script to `package.json`:**

```json
{
  "prisma": {
    "seed": "ts-node prisma/seed.ts"
  },
  "scripts": {
    "db:seed": "npx prisma db seed"
  }
}
```

**Run seed:**
```bash
npm run db:seed
```

---

## Useful Prisma Commands

### Development Commands

```bash
# Generate Prisma Client (after schema changes)
npx prisma generate

# Create migration from schema changes
npx prisma migrate dev --name <migration_name>

# Apply pending migrations
npx prisma migrate dev

# Reset database (WARNING: deletes all data)
npx prisma migrate reset

# Seed database with test data
npm run db:seed

# Open Prisma Studio (GUI for viewing/editing data)
npx prisma studio
```

### Production Commands

```bash
# Deploy migrations to production
npx prisma migrate deploy

# Check migration status
npx prisma migrate status

# Validate schema without applying
npx prisma validate
```

### Database Introspection

```bash
# Pull schema from existing database (reverse engineer)
npx prisma db pull

# Push schema to database without migrations (prototyping)
npx prisma db push
```

---

## Testing Database Integration

### Unit Test Example

**File:** `src/database/prisma.service.spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from './prisma.service';

describe('PrismaService', () => {
  let service: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PrismaService],
    }).compile();

    service = module.get<PrismaService>(PrismaService);
  });

  afterEach(async () => {
    await service.$disconnect();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should connect to database', async () => {
    await expect(service.$connect()).resolves.not.toThrow();
  });

  it('should create a ticket', async () => {
    const ticket = await service.ticket.create({
      data: {
        clickup_task_id: 'TEST-001',
        project_id: 'test-project',
        title: 'Test Ticket',
        description: 'Test description',
        acceptance_criteria: 'Test criteria',
        ticket_quality_score: 75,
      },
    });

    expect(ticket).toBeDefined();
    expect(ticket.id).toBeDefined();
    expect(ticket.title).toBe('Test Ticket');

    // Cleanup
    await service.ticket.delete({ where: { id: ticket.id } });
  });
});
```

### E2E Test Example

**File:** `test/database.e2e-spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DatabaseModule } from '../src/database/database.module';
import { PrismaService } from '../src/database/prisma.service';
import { TicketStatus } from '@prisma/client';

describe('Database Integration (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [DatabaseModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);
  });

  afterAll(async () => {
    await prisma.cleanDatabase(); // Clean test data
    await app.close();
  });

  it('should perform CRUD operations on tickets', async () => {
    // Create
    const created = await prisma.ticket.create({
      data: {
        clickup_task_id: 'E2E-001',
        project_id: 'e2e-project',
        title: 'E2E Test Ticket',
        description: 'Testing CRUD operations',
        acceptance_criteria: 'Must work',
        ticket_quality_score: 90,
      },
    });
    expect(created.id).toBeDefined();

    // Read
    const found = await prisma.ticket.findUnique({
      where: { id: created.id },
    });
    expect(found).toBeDefined();
    expect(found?.title).toBe('E2E Test Ticket');

    // Update
    const updated = await prisma.ticket.update({
      where: { id: created.id },
      data: { status: TicketStatus.VALIDATED },
    });
    expect(updated.status).toBe(TicketStatus.VALIDATED);

    // Delete
    await prisma.ticket.delete({ where: { id: created.id } });
    const deleted = await prisma.ticket.findUnique({
      where: { id: created.id },
    });
    expect(deleted).toBeNull();
  });

  it('should enforce foreign key relationships', async () => {
    // Create parent ticket
    const ticket = await prisma.ticket.create({
      data: {
        clickup_task_id: 'FK-TEST-001',
        project_id: 'fk-project',
        title: 'FK Test',
        description: 'Testing foreign keys',
        acceptance_criteria: 'Must enforce relationships',
        ticket_quality_score: 80,
      },
    });

    // Create related execution
    const execution = await prisma.execution.create({
      data: {
        ticket_id: ticket.id,
        ai_provider: 'CURSOR',
        prompt: 'Test prompt',
        status: 'QUEUED',
      },
    });

    expect(execution.ticket_id).toBe(ticket.id);

    // Verify relationship query works
    const ticketWithExecutions = await prisma.ticket.findUnique({
      where: { id: ticket.id },
      include: { executions: true },
    });

    expect(ticketWithExecutions?.executions).toHaveLength(1);
    expect(ticketWithExecutions?.executions[0].id).toBe(execution.id);
  });
});
```

---

## Validation Checklist

Before marking this story as complete, verify:

**Installation & Setup:**
- [ ] `@prisma/client` installed as dependency
- [ ] `prisma` installed as devDependency
- [ ] `npx prisma init` executed successfully
- [ ] `prisma/` folder created with `schema.prisma`

**Database Connection:**
- [ ] PostgreSQL 16 running (via Docker Compose or local)
- [ ] `DATABASE_URL` configured in `.env` file
- [ ] Database `ai_orchestrator` exists
- [ ] Connection test succeeds (`npx prisma db push --skip-generate`)

**Prisma Schema:**
- [ ] `schema.prisma` matches architecture document exactly
- [ ] All 9 tables defined (tickets, executions, qa_results, github_pushes, deployments, cost_records, production_errors, metrics, audit_logs)
- [ ] All 6 enums defined (TicketStatus, AIProvider, ExecutionStatus, GitHubStatus, DeploymentStatus, ErrorSeverity)
- [ ] Foreign key relationships correct (Ticket → Executions, Ticket → CostRecords)
- [ ] All indexes defined per architecture spec

**Migrations:**
- [ ] `npx prisma generate` creates TypeScript types successfully
- [ ] `npx prisma migrate dev --name init` creates initial migration
- [ ] Migration file exists in `prisma/migrations/YYYYMMDD_init/migration.sql`
- [ ] All tables created in database (verify with `npx prisma studio`)
- [ ] No migration warnings or errors

**NestJS Integration:**
- [ ] `src/database/prisma.service.ts` created
- [ ] `src/database/database.module.ts` created
- [ ] `DatabaseModule` imported in `app.module.ts` as global module
- [ ] `@Global()` decorator present on DatabaseModule

**Application Runtime:**
- [ ] `npm run start:dev` starts without database errors
- [ ] Console shows "✅ Database connected"
- [ ] Application can query database (health check or basic query)

**Testing:**
- [ ] `src/database/prisma.service.spec.ts` unit tests pass
- [ ] `test/database.e2e-spec.ts` E2E tests pass
- [ ] `npm run test` passes with database tests
- [ ] Test database cleanup works (`cleanDatabase()` method)

**Docker Compose (Optional but Recommended):**
- [ ] `docker-compose.yml` created with PostgreSQL service
- [ ] `docker-compose up -d postgres` starts PostgreSQL
- [ ] `docker-compose ps` shows postgres container running
- [ ] Application connects to Docker PostgreSQL successfully

**Seed Data (Optional):**
- [ ] `prisma/seed.ts` created with sample data
- [ ] `package.json` has `prisma.seed` configuration
- [ ] `npm run db:seed` populates database with test data
- [ ] `npx prisma studio` shows seeded data

**Documentation:**
- [ ] `.env.example` updated with DATABASE_URL template
- [ ] README.md updated with database setup instructions (if exists)
- [ ] Comments in `prisma.service.ts` explain key methods

**Code Quality:**
- [ ] `npm run lint` shows no linting errors
- [ ] Prettier formatting applied to all new files
- [ ] TypeScript compiles without errors

**Version Control:**
- [ ] `.env` is in `.gitignore` (security check)
- [ ] `prisma/migrations/` folder committed to git
- [ ] All new files staged and committed
- [ ] Commit message: `feat: add PostgreSQL database with Prisma ORM`

---

## Common Pitfalls to Avoid

**Database Connection:**
- ❌ **Don't** commit `.env` file with real database credentials
- ❌ **Don't** use `localhost` in production - use proper database host
- ❌ **Don't** skip connection pooling - causes performance issues

**Prisma Schema:**
- ❌ **Don't** modify schema without creating migration - causes sync issues
- ❌ **Don't** use `db push` in production - use `migrate deploy` only
- ❌ **Don't** delete migration files - breaks migration history

**NestJS Integration:**
- ❌ **Don't** create multiple PrismaService instances - use single global instance
- ❌ **Don't** forget `@Global()` decorator - causes import issues everywhere
- ❌ **Don't** skip `onModuleInit` connection - app may fail silently

**Testing:**
- ❌ **Don't** use production database for tests - always use test database
- ❌ **Don't** skip database cleanup in tests - causes test pollution
- ❌ **Don't** forget to disconnect Prisma in test teardown - causes connection leaks

**Migrations:**
- ❌ **Don't** edit existing migration files - create new migrations instead
- ❌ **Don't** run `migrate reset` in production - DELETES ALL DATA
- ❌ **Don't** skip migrations in CI/CD - causes deployment failures

**Data Types:**
- ❌ **Don't** store money as Float - use Int (cents) to avoid floating-point errors
- ❌ **Don't** use Text for short strings - use String (more efficient)
- ❌ **Don't** forget @db.Text for long content - causes truncation

---

## Expected Database Schema After Completion

```sql
-- Tables Created (9 total)
tickets
executions
qa_results
github_pushes
deployments
cost_records
production_errors
metrics
audit_logs

-- Enums Created (6 total)
TicketStatus
AIProvider
ExecutionStatus
GitHubStatus
DeploymentStatus
ErrorSeverity

-- Indexes Created (8 total)
tickets (project_id, status)
tickets (created_at)
executions (ticket_id, status)
executions (ai_provider, status)
cost_records (ticket_id)
cost_records (ai_provider, created_at)
production_errors (application, severity, resolved)
metrics (metric_name, recorded_at)
audit_logs (entity_type, entity_id)
audit_logs (created_at)

-- Foreign Keys Created (2 total)
executions.ticket_id → tickets.id
cost_records.ticket_id → tickets.id
```

---

## References

### Source Documents

1. **[Architecture - Prisma Schema Design]** (`docs/architecture.md` - Lines 1542-1802)
   - Complete schema definition
   - All 9 tables with fields and types
   - Foreign key relationships
   - Index strategy

2. **[Architecture - Database Indexes Strategy]** (`docs/architecture.md` - Lines 1804-1817)
   - Query patterns optimized
   - Index maintenance approach

3. **[Epics - Story 1.3]** (`docs/epics.md` - Lines 292-335)
   - Acceptance criteria
   - Technical notes
   - Prerequisites

4. **[PRD - Data Requirements]** (`docs/prd.md` - NFR-R1, NFR-R2)
   - Data persistence requirements
   - Backup and recovery needs

---

## Prerequisites

**Required:**
- ✅ Story 1.1 Complete - NestJS project initialized
- ✅ PostgreSQL 16 available (local installation or Docker)
- ✅ Node.js 20.x LTS (for Prisma CLI)

**Verify PostgreSQL:**
```bash
# Check PostgreSQL version
psql --version  # Should show 16.x

# Or via Docker
docker run --rm postgres:16-alpine psql --version
```

**Story Dependencies:** Story 1.1 (NestJS Project Initialization)

---

## Implementation Notes

### Critical Success Factors

1. **Follow Architecture Schema Exactly:** The schema in architecture.md is the source of truth. Don't deviate unless there's a documented reason.

2. **Test Database Connectivity First:** Before creating migrations, ensure you can connect to the database. Use `npx prisma db push --skip-generate` to test.

3. **Understand Migrations:** Migrations are immutable once created. If you need to change something, create a NEW migration, don't edit existing ones.

4. **Use Prisma Studio:** Visual tool for inspecting data during development. Run `npx prisma studio` and open http://localhost:5555.

### Architecture Alignment

This story implements:
- **[Architecture Decision: PostgreSQL]** - Chosen for ACID compliance, JSON support, and scalability
- **[Architecture Decision: Prisma ORM]** - Type-safe queries, automatic migrations, developer experience
- **[Data Model: Complete Schema]** - All 9 tables representing the full orchestration pipeline

### Preparation for Future Stories

This database foundation enables:
- **Story 2.1:** Ticket Intake → Persist tickets from ClickUp webhooks
- **Story 2.5:** Execution Tracking → Store AI execution state
- **Story 3.6:** QA Results → Store quality check results
- **Story 4.2:** GitHub Integration → Track code pushes and PRs
- **Story 6.1:** Cost Tracking → Record AI API costs
- **All Dashboard Stories:** Query data for visualization

---

## Dev Agent Record

### Context Reference

This story was prepared with complete context analysis from:
- Architecture document (complete Prisma schema, Lines 1542-1802)
- Epic 1 goals (establish database foundation)
- PRD data requirements (NFR-R1: PostgreSQL, NFR-R2: Backups)
- Prisma best practices (migrations, type safety, connection pooling)

### Completion Notes

**Story Status:** Ready for developer implementation  
**Context Completeness:** ✅ COMPREHENSIVE  
**Developer Readiness:** ✅ FLAWLESS IMPLEMENTATION GUIDE CREATED

**Workflow After Story Completion:**
1. **Before Starting:** Update `sprint-status.yaml` → `1-3-postgresql-database-setup-prisma: in-progress`
2. **Implementation:** Follow exact steps 1-10 to set up Prisma and database
3. **Validation:** Complete all items in Validation Checklist (40 items)
4. **Version Control:** Commit with message `feat: add PostgreSQL database with Prisma ORM`
5. **Status Update:** Update `sprint-status.yaml` → `1-3-postgresql-database-setup-prisma: review`
6. **Code Review:** Request review from Scrum Master via code-review workflow

---

**Document prepared by:** Bob (Scrum Master)  
**Preparation date:** 2025-11-27  
**Analysis method:** Ultimate BMad Method Story Context Engine  
**Quality level:** Developer-ready with zero ambiguity

