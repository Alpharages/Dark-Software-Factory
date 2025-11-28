# Story 1.1: NestJS Project Initialization

**Epic:** 1 - Foundation & Development Environment  
**Status:** Ready for Review  
**Priority:** P0 - BLOCKER  
**Effort:** 5 story points  
**ClickUp ID:** `86evnjw87`  
**ClickUp URL:** https://app.clickup.com/t/86evnjw87

---

## Story

As a developer,
I want a properly initialized NestJS project with TypeScript configuration,
So that I can start building the orchestrator with a solid foundation.

---

## Acceptance Criteria

**Given** I have the required tools installed (see Prerequisites section)  
**When** I run the project initialization command from architecture.md  
**Then** the NestJS project is created with the following structure:
- `/src` directory with main.ts entry point
- `/test` directory for e2e tests
- `tsconfig.json` configured for strict TypeScript
- `nest-cli.json` configured per architecture spec
- `.eslintrc.js` and `.prettierrc` for code quality
- `.gitignore` excluding node_modules, dist, .env
- `package.json` with core NestJS dependencies

**And** TypeScript compilation succeeds without errors  
**And** `npm run start:dev` launches the application successfully  
**And** Health check endpoint returns 200 OK at `/health`

---

## Technical Requirements

### Architecture Compliance

**Project Initialization Command** (Reference: architecture.md - "Project Initialization"):
```bash
npx @nestjs/cli new ai-dev-orchestrator --package-manager pnpm
```

**Options during setup:**
- Package manager: `pnpm`
- Enable strict TypeScript: `Yes`

**After initialization, replace Express with Fastify:**
```bash
cd ai-dev-orchestrator

# Remove Express
pnpm remove @nestjs/platform-express

# Install Fastify
pnpm add @nestjs/platform-fastify @fastify/static
```

**This establishes the base architecture with:**
- ✅ TypeScript configuration with strict mode
- ✅ NestJS modular structure (controllers, services, modules)
- ✅ Fastify HTTP server (2x faster than Express)
- ✅ Built-in testing framework (Jest)
- ✅ ESLint + Prettier for code consistency
- ✅ Dependency injection container
- ✅ Decorators for clean, declarative code

### HTTP Server: Fastify

**Why Fastify over Express:**

Fastify is chosen as the HTTP server for the AI Dev Tool Orchestrator due to:

1. **Performance:** 2x faster than Express, crucial for high-throughput AI orchestration
2. **TypeScript Support:** First-class TypeScript support out of the box
3. **Schema Validation:** Built-in JSON schema validation (reduces dependencies)
4. **Logging:** Integrated Pino logger for structured logging
5. **Plugin System:** Better encapsulation than Express middleware
6. **Async/Await:** Native async/await support without callback hell
7. **HTTP/2 Support:** Built-in HTTP/2 support for future scalability

**Key Differences from Express:**
- Fastify uses `@nestjs/platform-fastify` instead of `@nestjs/platform-express`
- Request/Response objects are Fastify types, not Express types
- Middleware becomes plugins
- Better performance for webhooks, AI task queuing, and real-time updates

---

### TypeScript Configuration

**File:** `tsconfig.json`

**Required compiler options:**
```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "strictPropertyInitialization": true,
    "noImplicitThis": true,
    "alwaysStrict": true,
    "target": "ES2021",
    "module": "commonjs",
    "moduleResolution": "node",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "baseUrl": "./",
    "paths": {
      "@/*": ["src/*"]
    }
  }
}
```

**Critical:** Strict mode is NON-NEGOTIABLE - it prevents type safety issues that could cause production bugs in the AI orchestrator.

### Core Dependencies

**File:** `package.json`

**Required NestJS dependencies:**
```json
{
  "dependencies": {
    "@nestjs/common": "^10.4.4",
    "@nestjs/core": "^10.4.4",
    "@nestjs/platform-fastify": "^10.4.4",
    "@fastify/static": "^7.0.4",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/cli": "^10.4.5",
    "@nestjs/schematics": "^10.2.3",
    "@nestjs/testing": "^10.4.4",
    "@types/jest": "^29.5.14",
    "@types/node": "^22.9.3",
    "@typescript-eslint/eslint-plugin": "^8.15.0",
    "@typescript-eslint/parser": "^8.15.0",
    "eslint": "^9.15.0",
    "eslint-config-prettier": "^9.1.0",
    "eslint-plugin-prettier": "^5.2.1",
    "jest": "^29.7.0",
    "prettier": "^3.3.3",
    "source-map-support": "^0.5.21",
    "ts-jest": "^29.2.5",
    "ts-loader": "^9.5.1",
    "ts-node": "^10.9.2",
    "tsconfig-paths": "^4.2.0",
    "typescript": "^5.6.3"
  }
}
```

### ESLint Configuration

**File:** `.eslintrc.js`

**Required configuration:**
```javascript
module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: 'tsconfig.json',
    tsconfigRootDir: __dirname,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint/eslint-plugin'],
  extends: [
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended',
  ],
  root: true,
  env: {
    node: true,
    jest: true,
  },
  ignorePatterns: ['.eslintrc.js'],
  rules: {
    '@typescript-eslint/interface-name-prefix': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'error',
  },
};
```

**Critical Rule:** `@typescript-eslint/no-explicit-any: 'error'` - Prevents unsafe `any` types that could hide bugs.

### Prettier Configuration

**File:** `.prettierrc`

**Required configuration:**
```json
{
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2,
  "semi": true,
  "arrowParens": "always",
  "endOfLine": "lf"
}
```

### NestJS CLI Configuration

**File:** `nest-cli.json`

**Required configuration:**
```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": {
    "deleteOutDir": true,
    "webpack": false,
    "tsConfigPath": "tsconfig.json"
  },
  "generateOptions": {
    "spec": true,
    "flat": false
  }
}
```

**Configuration notes:**
- `spec: true` - Automatically generate test files with new modules
- `flat: false` - Create dedicated folders for each generated component
- `deleteOutDir: true` - Clean dist folder before each build

### TypeScript Build Configuration

**File:** `tsconfig.build.json`

**Required configuration:**
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "removeComments": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "exclude": [
    "node_modules",
    "dist",
    "test",
    "**/*spec.ts",
    "**/*e2e-spec.ts"
  ]
}
```

**Build configuration notes:**
- Extends base `tsconfig.json` for consistency
- Removes comments in production build (reduces bundle size)
- Excludes test files from production compilation
- Generates source maps for production debugging

### Git Configuration

**File:** `.gitignore`

**Required exclusions:**
```gitignore
# Dependencies
node_modules/

# Build artifacts
dist/
build/

# Environment variables
.env
.env.local
.env.*.local

# IDE
.vscode/
.idea/
*.swp
*.swo

# Testing
coverage/

# Logs
logs/
*.log
npm-debug.log*

# OS
.DS_Store
Thumbs.db
```

### Health Check Endpoint

**File:** `src/main.ts`

**Required bootstrap code:**
```typescript
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: true }),
  );
  
  await app.listen(3000, '0.0.0.0');
  console.log(`Application is running on: ${await app.getUrl()}`);
}
bootstrap();
```

**File:** `src/app.controller.ts`

**Health check endpoint:**
```typescript
import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get('health')
  health() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'ai-dev-orchestrator',
    };
  }
}
```

---

## File Structure Requirements

**Expected directory structure after initialization:**

```
ai-dev-orchestrator/
├── src/
│   ├── app.controller.spec.ts      # Unit test for app controller
│   ├── app.controller.ts           # Main app controller with /health endpoint
│   ├── app.module.ts               # Root module
│   ├── app.service.ts              # Main app service
│   └── main.ts                     # Application entry point (Fastify)
├── test/
│   ├── app.e2e-spec.ts            # End-to-end test
│   └── jest-e2e.json              # E2E test configuration
├── .eslintrc.js                    # ESLint configuration
├── .gitignore                      # Git exclusions
├── .prettierrc                     # Prettier configuration
├── nest-cli.json                   # NestJS CLI configuration
├── package.json                    # pnpm dependencies
├── README.md                       # Project documentation
├── tsconfig.build.json            # Production TypeScript config
└── tsconfig.json                   # TypeScript configuration
```

**Naming Conventions** (Reference: architecture.md - "Project Structure"):
- Use kebab-case for all files and folders
- Controllers: `*.controller.ts`
- Services: `*.service.ts`
- Modules: `*.module.ts`
- Tests: `*.spec.ts` (unit), `*.e2e-spec.ts` (e2e)
- DTOs: `*.dto.ts`

---

## Testing Requirements

### Unit Tests

**File:** `src/app.controller.spec.ts`

**Required test:**
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('health', () => {
    it('should return health status', () => {
      const result = appController.health();
      expect(result).toHaveProperty('status', 'ok');
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('service', 'ai-dev-orchestrator');
    });
  });
});
```

### E2E Tests

**File:** `test/app.e2e-spec.ts`

**Required test:**
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: NestFastifyApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('/health (GET)', () => {
    return app
      .inject({
        method: 'GET',
        url: '/health',
      })
      .then((result) => {
        expect(result.statusCode).toBe(200);
        const body = JSON.parse(result.payload);
        expect(body).toHaveProperty('status', 'ok');
        expect(body).toHaveProperty('timestamp');
        expect(body).toHaveProperty('service', 'ai-dev-orchestrator');
      });
  });
});
```

### Test Execution

**Commands:**
```bash
# Run unit tests
pnpm test

# Run unit tests in watch mode
pnpm test:watch

# Run e2e tests
pnpm test:e2e

# Generate coverage report (must achieve >80% per NFR-M1)
pnpm test:cov
```

---

## Development Commands

**Start application:**
```bash
# Development mode (with hot reload)
pnpm start:dev

# Production mode
pnpm start:prod
```

**Build application:**
```bash
# Compile TypeScript to JavaScript
pnpm build
```

**Code quality:**
```bash
# Run linting
pnpm lint

# Fix linting issues automatically
pnpm lint:fix

# Format code with Prettier
pnpm format
```

---

## Validation Checklist

Before marking this story as complete, verify:

**Project Initialization:**
- [x] NestJS project created with exact command from architecture.md
- [x] `package.json` contains all required dependencies with correct versions
- [x] `@nestjs/platform-fastify` installed (not Express)
- [x] `@fastify/static` installed for static file serving
- [x] All configuration files present: `tsconfig.json`, `tsconfig.build.json`, `nest-cli.json`, `.eslintrc.js`, `.prettierrc`, `.gitignore`

**TypeScript & Code Quality:**
- [x] `tsconfig.json` has strict mode enabled (`strict: true` and all strict options)
- [x] `tsconfig.build.json` extends base config and excludes test files
- [x] ESLint configured with NestJS recommended rules and `no-explicit-any: error`
- [x] Prettier configured with project formatting standards

**Build & Execution:**
- [x] `pnpm install` completes without errors
- [x] `pnpm build` compiles TypeScript successfully
- [x] `pnpm start:dev` starts application without errors
- [x] Application console log shows "Application is running on: http://[::1]:3000"

**Health Check Endpoint:**
- [x] `GET /health` returns 200 OK
- [x] Response contains `status: "ok"`, `timestamp`, and `service: "ai-dev-orchestrator"`

**Testing:**
- [x] `pnpm test` passes all unit tests
- [x] `pnpm test:e2e` passes health check e2e test
- [x] Unit test covers health endpoint with proper assertions
- [x] E2E test verifies HTTP endpoint behavior

**Code Quality:**
- [x] `pnpm lint` shows no linting errors
- [x] `pnpm format` produces no changes (code already formatted)

**Documentation:**
- [x] `README.md` created with complete content per template
- [x] Code contains comments explaining key configurations

**Version Control:**
- [x] Git repository initialized (`.git` folder exists)
- [x] All project files staged and committed
- [x] Initial commit message follows format: `feat: initialize NestJS project with TypeScript strict mode`
- [x] `.gitignore` excludes node_modules, dist, .env, and IDE files

---

## References

### Source Documents

1. **[Architecture - Project Initialization]** (`docs/architecture.md` - Section "Project Initialization")
   - Exact initialization command
   - Technology stack decisions
   - TypeScript configuration requirements

2. **[Architecture - Complete Project Structure]** (`docs/architecture.md` - Section "Complete Project Structure")
   - Expected directory structure
   - Naming conventions (kebab-case)
   - Module organization patterns

3. **[Architecture - Technology Stack Details]** (`docs/architecture.md` - Section "Technology Stack Details")
   - NestJS 10.x framework justification
   - TypeScript 5.x strict mode requirements
   - Testing framework (Jest + Supertest)

4. **[PRD - Scope Definition]** (`docs/prd.md` - Section "MVP Scope (Phase 1: Validation)")
   - AI Dev Tool Orchestrator context
   - Foundation for all subsequent features

5. **[Epics - Epic 1]** (`docs/epics.md` - Section "Epic 1: Foundation & Development Environment")
   - Epic goal and user value
   - Story 1.1 full acceptance criteria

6. **[Non-Functional Requirements]** (`docs/prd.md` - Section "Non-Functional Requirements")
   - NFR-M1: Test coverage >80%
   - NFR-M2: Code consistency (ESLint + Prettier)
   - NFR-M4: Configuration management

---

## Prerequisites

**Required Tools:**
- **Node.js** 22.x LTS or higher
- **pnpm** 10.x or higher
- **Git** 2.x or higher

**Verify installation:**
```bash
node --version  # Should show v22.x.x
pnpm --version  # Should show 10.x.x
git --version   # Should show 2.x.x
```

**Install pnpm (if not installed):**
```bash
npm install -g pnpm@latest
# or
corepack enable pnpm
corepack prepare pnpm@latest --activate
```

**Story Dependencies:** None - This is the first story in Epic 1.

---

## README.md Template

**File:** `README.md`

**Required content:**
```markdown
# AI Dev Tool Orchestrator

> Part of Dark Software Factory - AI-augmented software development transformation

## Overview

The AI Dev Tool Orchestrator is a NestJS microservice that automates the complete pipeline from PM-created tickets to deployed code, connecting ClickUp webhooks → AI code generation (Cursor + Claude Code) → automated QA → GitHub → CI/CD deployment → production monitoring.

## Quick Start

### Prerequisites

**Required Tools:**
- Node.js 22.x LTS or higher
- pnpm 10.x or higher  
- Git 2.x or higher

**Verify installation:**
```bash
node --version  # Should show v22.x.x
pnpm --version  # Should show 10.x.x
git --version   # Should show 2.x.x
```

**Install pnpm (if not installed):**
```bash
npm install -g pnpm@latest
# or
corepack enable pnpm
corepack prepare pnpm@latest --activate
```

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd ai-dev-orchestrator

# Install dependencies
pnpm install

# Start development server
pnpm start:dev
```

### Health Check

Visit `http://localhost:3000/health` to verify the application is running.

**Expected response:**
```json
{
  "status": "ok",
  "timestamp": "2025-11-27T...",
  "service": "ai-dev-orchestrator"
}
```

## Available Scripts

- `pnpm start:dev` - Start in development mode with hot reload
- `pnpm start:prod` - Start in production mode
- `pnpm build` - Build for production
- `pnpm test` - Run unit tests
- `pnpm test:watch` - Run tests in watch mode
- `pnpm test:e2e` - Run end-to-end tests
- `pnpm test:cov` - Generate test coverage report (target >80%)
- `pnpm lint` - Run ESLint checks
- `pnpm lint:fix` - Fix ESLint issues automatically
- `pnpm format` - Format code with Prettier

## Project Structure

```
ai-dev-orchestrator/
├── src/
│   ├── app.controller.ts       # Health check endpoint
│   ├── app.module.ts           # Root module
│   ├── app.service.ts          # Main service
│   └── main.ts                 # Application entry point (Fastify)
├── test/
│   └── app.e2e-spec.ts        # E2E tests
├── .eslintrc.js                # ESLint configuration
├── .prettierrc                 # Prettier configuration
├── nest-cli.json               # NestJS CLI configuration
├── tsconfig.json               # TypeScript configuration
└── package.json                # Dependencies (pnpm)
```

See [Architecture Documentation](../docs/architecture.md) for complete project structure.

## Development Workflow

1. **Start Development Server:** `pnpm start:dev`
2. **Make Changes:** Edit files in `src/`
3. **Run Tests:** `pnpm test` (unit) or `pnpm test:e2e`
4. **Check Code Quality:** `pnpm lint && pnpm format`
5. **Build:** `pnpm build` (compiles to `dist/`)

## Next Steps

After initialization, proceed to:
- **Story 1.2:** Project Structure & Module Organization
- **Story 1.3:** PostgreSQL Database Setup with Prisma
- **Story 1.4:** Environment Configuration & Secrets Management

## Documentation

- [Architecture](../docs/architecture.md) - Technical architecture decisions
- [PRD](../docs/prd.md) - Product requirements
- [Epics](../docs/epics.md) - Epic and story breakdown

## Technology Stack

- **Framework:** NestJS 10.x
- **HTTP Server:** Fastify 4.x (2x faster than Express)
- **Language:** TypeScript 5.x (strict mode)
- **Runtime:** Node.js 22.x LTS
- **Testing:** Jest + Supertest
- **Code Quality:** ESLint + Prettier
- **Package Manager:** pnpm 10.x

---

**Status:** Story 1.1 Complete - Foundation Established ✅
```

---

## Implementation Notes

### Critical Success Factors

1. **Strict TypeScript Mode:** This is NON-NEGOTIABLE. Strict mode prevents type safety issues that could cause catastrophic bugs in production AI orchestration.

2. **Fastify HTTP Server:** Fastify is 2x faster than Express with better performance for high-throughput AI orchestration operations. It provides excellent TypeScript support and a robust plugin ecosystem.

3. **Health Check Endpoint:** This simple endpoint is the foundation for monitoring, observability, and deployment health checks in later stories.

4. **Code Quality Tools:** ESLint and Prettier must be configured from Day 1 to prevent technical debt accumulation.

5. **Test Foundation:** Jest and Supertest setup now enables TDD (Test-Driven Development) for all future stories.

### Common Pitfalls to Avoid

**TypeScript Configuration:**
- ❌ **Don't** use `any` type anywhere - it defeats the purpose of TypeScript
- ❌ **Don't** skip strict mode to "save time" - it creates massive technical debt
- ❌ **Don't** disable strict null checks - they prevent runtime errors

**Dependency Management:**
- ❌ **Don't** use different package versions than specified - may cause compatibility issues
- ❌ **Don't** run `pnpm install` without `pnpm-lock.yaml` - causes version drift
- ❌ **Don't** mix package managers (npm, yarn, pnpm) - causes lock file conflicts

**Version Control:**
- ❌ **Don't** modify `.gitignore` to commit `.env` files - critical security risk
- ❌ **Don't** commit `node_modules/` or `dist/` folders - bloats repository
- ❌ **Don't** skip initial commit - breaks workflow assumptions in later stories

**Implementation:**
- ❌ **Don't** skip the health check endpoint - it's needed for deployment monitoring
- ❌ **Don't** modify the NestJS default port (3000) yet - will be configurable in Story 1.4
- ❌ **Don't** use Express-specific middleware - Fastify has its own plugin system

### Architecture Alignment

This story implements:
- **[ADR-001]** TypeScript strict mode for type safety
- **[ADR-002]** NestJS as backend framework
- **[ADR-003]** Fastify as HTTP server for performance
- **[Decision Summary Table]** Language: TypeScript 5.x, Framework: NestJS 10.x, Server: Fastify 4.x
- **[Performance Requirements]** NFR-P1: API response times <200ms (Fastify's speed helps achieve this)

---

## File List

- ai-dev-orchestrator/.eslintrc.js
- ai-dev-orchestrator/.gitignore
- ai-dev-orchestrator/.prettierrc
- ai-dev-orchestrator/README.md
- ai-dev-orchestrator/nest-cli.json
- ai-dev-orchestrator/package.json
- ai-dev-orchestrator/src/app.controller.spec.ts
- ai-dev-orchestrator/src/app.controller.ts
- ai-dev-orchestrator/src/app.module.ts
- ai-dev-orchestrator/src/app.service.ts
- ai-dev-orchestrator/src/main.ts
- ai-dev-orchestrator/test/app.e2e-spec.ts
- ai-dev-orchestrator/test/jest-e2e.json
- ai-dev-orchestrator/tsconfig.build.json
- ai-dev-orchestrator/tsconfig.json

## Change Log

- **Initialized Project**: Created NestJS project with pnpm.
- **Configured TypeScript**: Enabled strict mode and decorators in `tsconfig.json`.
- **Replaced Express with Fastify**: Updated `package.json` and `main.ts`.
- **Implemented Health Check**: Added `/health` endpoint in `AppController`.
- **Added Tests**: Updated unit and E2E tests for health check.
- **Configured Linting**: Set up `.eslintrc.js` and `.prettierrc`.

---

## Dev Agent Record

### Context Reference

This story was prepared with complete context analysis from:
- PRD functional requirements (FR56-FR95 infrastructure foundation)
- Architecture document (complete technology stack decisions)
- Epic 1 goals (development team can build, test, deploy with confidence)
- UX design specification (foundation for future dashboard integration)

### Completion Notes

**Story Status:** Ready for Review
**Context Completeness:** ✅ COMPREHENSIVE  
**Developer Readiness:** ✅ FLAWLESS IMPLEMENTATION GUIDE CREATED
**Implementation Status:** ✅ COMPLETE
**Verification:** ✅ ALL TESTS PASSED (Lint, Build, Unit, E2E)

**Workflow After Story Completion:**
1. **Before Starting:** Update `sprint-status.yaml` → `1-1-nestjs-project-initialization: in-progress`
2. **Implementation:** Follow exact specifications in this story
3. **Validation:** Complete all items in Validation Checklist
4. **Version Control:** Commit with message `feat: initialize NestJS project with TypeScript strict mode`
5. **Status Update:** Update `sprint-status.yaml` → `1-1-nestjs-project-initialization: review`
6. **Code Review:** Request review from Scrum Master via code-review workflow

---

**Document prepared by:** Bob (Scrum Master)  
**Preparation date:** 2025-11-27  
**Analysis method:** Ultimate BMad Method Story Context Engine  
**Quality level:** Developer-ready with zero ambiguity

