# Story 8.4: Quality Gate Configuration

**Epic:** 8 - Lead QA Manual Review Workflow  
**Status:** ready-for-dev  
**Priority:** High  
**Estimation:** 3 days  
**Story Points:** 5

---

## Story

As a Lead QA,  
I want to configure quality gate thresholds per project,  
so that quality standards can be tailored to project requirements and risk profiles.

---

## Context

Story 3.5 (Quality Gate Decision Engine) established the foundational quality gate system with environment-based default thresholds via `DEFAULT_THRESHOLDS` constant. However, FR39 requires Lead QA to define project-specific quality gates that must pass before human review. Different projects have different risk tolerances, tech stacks, and quality requirements. A prototype/MVP project may have lower coverage thresholds than a production financial system. This story enables per-project quality gate configuration with an intuitive management interface for Lead QA.

**Quality Gate Categories Configurable:**

- **Test Pass Rate:** Minimum percentage of tests that must pass
- **Code Coverage:** Minimum line/branch coverage percentage
- **Linting:** Maximum allowed errors and warnings
- **Security:** Block on critical/high vulnerabilities
- **Complexity:** Maximum cyclomatic complexity score
- **Enabled Categories:** Toggle which quality checks are active (linting, testing, coverage, security)

---

## Acceptance Criteria

### AC#1: Project-Specific Quality Gate Configuration API

**Given** I am a Lead QA with appropriate permissions  
**When** I access the quality gate configuration endpoint for a project  
**Then** I can configure the following thresholds:

| Threshold                 | Type       | Default | Range      |
| ------------------------- | ---------- | ------- | ---------- |
| `minTestPassRate`         | percentage | 100%    | 0-100%     |
| `minCoverage`             | percentage | 80%     | 0-100%     |
| `maxLintingErrors`        | integer    | 0       | 0-999      |
| `maxLintingWarnings`      | integer    | 10      | 0-999      |
| `blockOnCriticalSecurity` | boolean    | true    | true/false |
| `blockOnHighSecurity`     | boolean    | true    | true/false |
| `maxComplexity`           | integer    | 20      | 1-50       |
| `targetCoverage`          | percentage | 90%     | 0-100%     |

**And** I can enable/disable specific quality categories via `enabledCategories` array: `[LINTING, TESTING, COVERAGE, SECURITY]`  
**And** the configuration is persisted to the database  
**And** changes take effect immediately for new quality gate evaluations  
**And** an audit log entry is created for each configuration change.

### AC#2: Global Default Configuration

**Given** no project-specific configuration exists  
**When** the Quality Gate Decision Engine evaluates a ticket  
**Then** it uses global defaults from the database (not environment variables)  
**And** global defaults can only be modified by users with `ADMIN` or `QA` role  
**And** global defaults serve as the template for new project configurations.

### AC#3: Configuration Inheritance and Override

**Given** a project has a quality gate configuration  
**When** evaluating quality gates for that project  
**Then** project-specific settings override global defaults  
**And** partial configurations are merged with global defaults using this strategy:

```typescript
// Merge strategy: project config takes precedence, undefined fields use global
const effectiveConfig = {
  ...globalConfig,
  ...projectConfig, // Overwrites where defined
};
```

**And** the effective configuration is returned via API for UI display.

### AC#4: Configuration Validation

**Given** I submit a quality gate configuration  
**When** the system validates the input  
**Then** it enforces:

- `minTestPassRate` ≤ 100 and ≥ 0
- `minCoverage` ≤ 100 and ≥ 0
- `maxLintingErrors` ≥ 0
- `maxLintingWarnings` ≥ 0
- `maxComplexity` ≥ 1
- `targetCoverage` ≥ `minCoverage` (cannot target lower than minimum)
- `enabledCategories` must be non-empty array of valid `QualityCategory` values

**And** invalid configurations are rejected with descriptive error messages  
**And** validation uses class-validator decorators on DTOs (reuse from Story 3.5).

### AC#5: Configuration History and Audit Trail

**Given** quality gate configurations change over time  
**When** viewing configuration history  
**Then** I can see:

- Previous configuration values (full snapshot)
- Who made each change
- Timestamp of change
- Reason for change (if provided)
- Version number for rollback

**And** configuration changes are logged via `AIDecisionLogger` (Story 11.2)  
**And** full snapshots are stored in `QualityGateConfigHistory` table for compliance  
**And** history is queryable via API.

### AC#6: Quality Gate Preview

**Given** I am configuring quality gates for a project  
**When** I request a preview  
**Then** the system shows:

- How many recent tickets would PASS with these settings
- How many recent tickets would FAIL with these settings
- Which specific thresholds caused failures
- Comparison with current configuration impact

**Implementation Note:** Query `QAResult` model (Story 3.5) for last 30 days of results.

**Endpoint:** `POST /api/v1/quality-gates/preview`

### AC#7: RBAC Enforcement

**Given** the quality gate configuration endpoints  
**When** accessed by different roles  
**Then:**

| Role    | Permissions                                                           |
| ------- | --------------------------------------------------------------------- |
| `ADMIN` | Full CRUD on global defaults and all projects                         |
| `QA`    | Full CRUD on all project configs, read global defaults (Lead QA role) |
| `PM`    | Read-only access to their project configurations                      |
| `TL`    | Read-only access to all configurations                                |

---

## API Endpoints

### Get Project Configuration

```
GET /api/v1/quality-gates/config/:projectId
```

**Response:** `200 OK`

```json
{
  "projectId": "uuid",
  "projectName": "Client Portal",
  "configuration": {
    "minTestPassRate": 100,
    "minCoverage": 80,
    "maxLintingErrors": 0,
    "maxLintingWarnings": 10,
    "blockOnCriticalSecurity": true,
    "blockOnHighSecurity": true,
    "maxComplexity": 20,
    "targetCoverage": 90,
    "enabledCategories": ["LINTING", "TESTING", "COVERAGE", "SECURITY"]
  },
  "effectiveConfiguration": {
    "minTestPassRate": 100,
    "minCoverage": 85,
    "maxLintingErrors": 0,
    "maxLintingWarnings": 5,
    "blockOnCriticalSecurity": true,
    "blockOnHighSecurity": false,
    "maxComplexity": 15,
    "targetCoverage": 95,
    "enabledCategories": ["LINTING", "TESTING", "COVERAGE", "SECURITY"]
  },
  "isUsingGlobalDefaults": false,
  "version": 3,
  "lastModifiedAt": "2026-02-03T12:00:00Z",
  "lastModifiedBy": {
    "id": "uuid",
    "name": "Jane Doe"
  }
}
```

### Update Project Configuration

```
PUT /api/v1/quality-gates/config/:projectId
```

**Request Body:**

```json
{
  "minTestPassRate": 100,
  "minCoverage": 85,
  "maxLintingErrors": 0,
  "maxLintingWarnings": 5,
  "blockOnCriticalSecurity": true,
  "blockOnHighSecurity": false,
  "maxComplexity": 15,
  "targetCoverage": 95,
  "enabledCategories": ["LINTING", "TESTING", "COVERAGE"],
  "reason": "Increasing standards for production release"
}
```

### Get Global Default Configuration

```
GET /api/v1/quality-gates/config/defaults
```

### Update Global Default Configuration

```
PUT /api/v1/quality-gates/config/defaults
```

**RBAC:** `ADMIN` or `QA` only

### Preview Configuration Impact

```
POST /api/v1/quality-gates/preview
```

**Request Body:**

```json
{
  "projectId": "uuid",
  "configuration": {
    "minCoverage": 90,
    "maxComplexity": 10
  }
}
```

**Response:**

```json
{
  "previewResults": {
    "totalTicketsAnalyzed": 50,
    "wouldPass": 35,
    "wouldFail": 15,
    "currentPassRate": 42,
    "impact": "-7 tickets would fail with new configuration"
  },
  "failureBreakdown": {
    "minCoverage": 8,
    "maxComplexity": 5,
    "maxLintingErrors": 2
  }
}
```

### Get Configuration History

```
GET /api/v1/quality-gates/config/:projectId/history
```

### Clone Configuration to Projects

```
POST /api/v1/quality-gates/config/:sourceProjectId/clone
```

**Request Body:**

```json
{
  "targetProjectIds": ["uuid-1", "uuid-2"],
  "reason": "Standardizing quality gates across client portals"
}
```

---

## Technical Design

### Database Schema

**New Table: `QualityGateConfig`**

```prisma
model QualityGateConfig {
  id                    String   @id @default(uuid())
  projectId             String?  @unique // null = global default
  project               Project? @relation(fields: [projectId], references: [id])

  // Thresholds (align with Story 3.5 DEFAULT_THRESHOLDS)
  minTestPassRate       Int      @default(100) // percentage
  minCoverage           Int      @default(80)  // percentage
  maxLintingErrors      Int      @default(0)
  maxLintingWarnings    Int      @default(10)
  blockOnCriticalSecurity Boolean @default(true)
  blockOnHighSecurity   Boolean  @default(true)
  maxComplexity         Int      @default(20)  // Aligned with Story 3.5
  targetCoverage        Int      @default(90)  // percentage

  // Category enablement (from Story 3.5 IQualityGateConfig)
  enabledCategories     Json     @default("[\"LINTING\",\"TESTING\",\"COVERAGE\",\"SECURITY\"]")

  // Override settings (from Story 3.5 IQualityGateConfig)
  allowOverride         Boolean  @default(false)
  overrideRequiresApproval Boolean @default(true)

  // Versioning for rollback
  version               Int      @default(1)

  // Metadata
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt
  createdById           String
  createdBy             User     @relation("QualityGateConfigCreatedBy", fields: [createdById], references: [id])
  updatedById           String
  updatedBy             User     @relation("QualityGateConfigUpdatedBy", fields: [updatedById], references: [id])

  // Relations
  history               QualityGateConfigHistory[]

  @@index([projectId])
}
```

**New Table: `QualityGateConfigHistory`**

```prisma
model QualityGateConfigHistory {
  id          String   @id @default(uuid())
  configId    String
  config      QualityGateConfig @relation(fields: [configId], references: [id])
  projectId   String?

  // Full configuration snapshot as JSON
  snapshot    Json     // Contains all threshold values, enabledCategories, etc.
  version     Int      // Version number at time of change

  // Change metadata
  changedById String
  changedBy   User     @relation(fields: [changedById], references: [id])
  changedAt   DateTime @default(now())
  changeReason String?

  @@index([configId])
  @@index([projectId])
  @@index([changedAt])
}
```

### Service Architecture

**`QualityGateConfigService`** - Core configuration management

```typescript
@Injectable()
export class QualityGateConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogger: AIDecisionLoggerService,
    private readonly configService: ConfigService,
  ) {}

  // Get effective config (project-specific merged with global default)
  // Merge strategy: project config takes precedence, undefined uses global
  async getEffectiveConfig(projectId?: string): Promise<IQualityGateConfig>;

  // Get project-specific config only (no merge)
  async getProjectConfig(projectId: string): Promise<QualityGateConfig | null>;

  // Get global default config
  async getGlobalConfig(): Promise<QualityGateConfig>;

  // Create/update project config - increments version, creates history snapshot
  async updateProjectConfig(
    projectId: string,
    dto: UpdateQualityGateConfigDto,
    userId: string,
  ): Promise<QualityGateConfig>;

  // Update global defaults - restricted to ADMIN/QA roles
  async updateGlobalConfig(
    dto: UpdateQualityGateConfigDto,
    userId: string,
  ): Promise<QualityGateConfig>;

  // Clone config from source project to target projects
  async cloneConfig(
    sourceProjectId: string,
    targetProjectIds: string[],
    userId: string,
  ): Promise<CloneResult>;

  // Preview configuration impact using QAResult records
  async previewConfigImpact(
    projectId: string,
    config: Partial<IQualityThresholds>,
  ): Promise<ConfigPreviewResult>;

  // Get configuration history with pagination
  async getConfigHistory(projectId?: string, limit?: number): Promise<QualityGateConfigHistory[]>;

  // Seed global defaults from environment variables (migration)
  async seedGlobalDefaultsFromEnv(userId: string): Promise<QualityGateConfig>;
}
```

**Modify `QualityGatesService` (Story 3.5)**

```typescript
// Replace existing loadConfig() method:
async loadConfig(projectId: string): Promise<IQualityGateConfig> {
  // 1. Try to get from database via QualityGateConfigService
  // 2. Fallback to global defaults if no project config
  // 3. Ultimate fallback: environment variables (backward compat)
}
```

### Controller

**`QualityGateConfigController`** - `/api/v1/quality-gates/config`

- `GET /:projectId` - Get project config (with effective config)
- `PUT /:projectId` - Update project config (QA, ADMIN)
- `GET /defaults` - Get global defaults
- `PUT /defaults` - Update global defaults (ADMIN, QA)
- `GET /:projectId/history` - Get config history
- `POST /preview` - Preview config impact
- `POST /:sourceProjectId/clone` - Clone config to other projects

### Integration Points

| Component                   | Integration                                                              |
| --------------------------- | ------------------------------------------------------------------------ |
| `QualityGatesService` (3.5) | Uses `QualityGateConfigService.getEffectiveConfig()` instead of env vars |
| `AIDecisionLogger` (11.2)   | Logs all config changes with before/after values                         |
| `QAResult` Model (3.5)      | Queried for preview impact analysis                                      |
| `ProjectModule`             | Project entity relation to QualityGateConfig                             |
| `AuthModule`                | RolesGuard for RBAC enforcement (use `Role.QA` not `LEAD_QA`)            |
| `PrismaModule`              | Database persistence                                                     |

---

## Tasks / Subtasks

### Task 1: Database Schema (AC: #1, #2, #5)

- [ ] Create `QualityGateConfig` model in Prisma schema
  - Include all threshold fields aligned with Story 3.5
  - Add `enabledCategories` Json field
  - Add `allowOverride` and `overrideRequiresApproval` boolean fields
  - Add `version` Int field for rollback support
- [ ] Create `QualityGateConfigHistory` model with JSON snapshot pattern
- [ ] Add relations to `Project` and `User` models
- [ ] Generate and run Prisma migration
- [ ] Generate Prisma client types

### Task 2: DTOs and Validation (AC: #1, #4)

- [ ] Create `UpdateQualityGateConfigDto` - extends/enhances Story 3.5 DTOs
  - Import base validators from `quality-gate.dto.ts` (Story 3.5)
  - Add `enabledCategories` validation (array of enum values)
  - Add `reason` optional field for audit trail
- [ ] Create `CloneConfigDto` for bulk clone endpoint
- [ ] Create `ConfigPreviewRequestDto` and `ConfigPreviewResponseDto`
- [ ] Create response DTOs for API consistency

### Task 3: QualityGateConfigService (AC: #1, #2, #3, #5)

- [ ] Implement `getEffectiveConfig()` with merge logic (project > global)
- [ ] Implement `getProjectConfig()` and `getGlobalConfig()`
- [ ] Implement `updateProjectConfig()` with:
  - Version increment
  - History snapshot creation
  - Audit logging via AIDecisionLogger
  - Cache invalidation (if caching implemented)
- [ ] Implement `updateGlobalConfig()` with RBAC check
- [ ] Implement `cloneConfig()` for bulk configuration copying
- [ ] Implement `previewConfigImpact()` using QAResult queries
- [ ] Implement `getConfigHistory()` with pagination
- [ ] Implement `seedGlobalDefaultsFromEnv()` for migration

### Task 4: Modify QualityGatesService (AC: #2, #3)

- [ ] Refactor `loadConfig()` in `quality-gates.service.ts` to use `QualityGateConfigService`
- [ ] Maintain backward compatibility:
  ```typescript
  // Fallback chain: Database > Global Config > Environment Variables
  ```
- [ ] Update unit tests for new config loading
- [ ] Add cache invalidation when configs change (optional)

### Task 5: Controller and API (AC: #1, #6, #7)

- [ ] Create `QualityGateConfigController` at `/api/v1/quality-gates/config`
- [ ] Implement all endpoints with proper decorators
- [ ] Add `RolesGuard` and `JwtAuthGuard` to all endpoints
- [ ] Configure route-specific RBAC (use `Role.QA` for Lead QA)
- [ ] Add Swagger documentation annotations

### Task 6: Migration and Seeding (AC: #2)

- [ ] Create migration script to seed global defaults from environment variables
- [ ] Map env vars to database fields:
  - `QUALITY_GATE_MIN_TEST_PASS_RATE` → `minTestPassRate`
  - `QUALITY_GATE_MIN_COVERAGE` → `minCoverage`
  - etc.
- [ ] Run seed on application startup if no global config exists

### Task 7: Integration and Testing (AC: All)

- [ ] Wire up `QualityGateConfigModule` in `QaAutomationModule`
- [ ] Write unit tests for `QualityGateConfigService` (>80% coverage)
- [ ] Write unit tests for `QualityGateConfigController`
- [ ] Write E2E tests for configuration API
- [ ] Verify integration with `QualityGatesService.loadConfig()`
- [ ] Test migration from env vars to database

---

## Dev Notes

### Project Structure Alignment

```
src/
├── qa-automation/
│   ├── quality-gate-config/          # NEW subdirectory
│   │   ├── quality-gate-config.service.ts
│   │   ├── quality-gate-config.controller.ts
│   │   ├── quality-gate-config.module.ts
│   │   ├── dto/
│   │   │   ├── update-quality-gate-config.dto.ts
│   │   │   ├── clone-config.dto.ts
│   │   │   ├── config-preview.dto.ts
│   │   │   └── quality-gate-config-response.dto.ts
│   │   └── interfaces/
│   │       └── config-preview.interface.ts
│   ├── quality-gates/
│   │   ├── quality-gates.service.ts (MODIFY: update loadConfig)
│   │   └── dto/
│   │       └── quality-gate.dto.ts (Story 3.5 - REUSE)
│   └── qa-automation.module.ts (MODIFY)
└── prisma/
    └── models/
        └── QualityGateConfig.ts (generated)
```

### Key Implementation Details

1. **Configuration Precedence:**

   ```
   Project Config > Global Config > Environment Variables (legacy fallback)
   ```

2. **Merge Strategy:**

   ```typescript
   // Explicit merge logic for AC#3
   const effectiveConfig = {
     ...globalConfig,
     ...projectConfig, // Overwrites where defined
   };
   ```

3. **Audit Logging Pattern:**

   ```typescript
   await this.auditLogger.log({
     action: 'QUALITY_GATE_CONFIG_UPDATED',
     projectId,
     userId,
     metadata: {
       previousValues: oldConfig,
       newValues: newConfig,
       reason: dto.reason,
       version: newVersion,
     },
   });
   ```

4. **History Snapshot Pattern:**

   ```typescript
   // Store full config as JSON snapshot
   await this.prisma.qualityGateConfigHistory.create({
     data: {
       configId: config.id,
       snapshot: config, // Full config object as JSON
       version: config.version,
       changedById: userId,
       changeReason: dto.reason,
     },
   });
   ```

5. **Preview Query Logic (AC#6):**

   ```typescript
   // Query QAResult model from Story 3.5
   const results = await this.prisma.qAResult.findMany({
     where: {
       projectId,
       createdAt: { gte: thirtyDaysAgo },
     },
   });
   // Apply new thresholds to historical results
   // Count pass/fail outcomes
   ```

6. **Migration from Environment Config:**
   ```typescript
   async seedGlobalDefaultsFromEnv(userId: string): Promise<QualityGateConfig> {
     const existing = await this.getGlobalConfig().catch(() => null);
     if (existing) return existing;

     // Seed from environment variables
     return this.prisma.qualityGateConfig.create({
       data: {
         projectId: null, // Global default
         minTestPassRate: this.configService.get('qualityGate.minTestPassRate', 100),
         minCoverage: this.configService.get('qualityGate.minCoverage', 80),
         // ... other fields
         createdById: userId,
         updatedById: userId,
       },
     });
   }
   ```

### Dependencies

- **Story 3.5: Quality Gate Decision Engine** (Completed)
  - Reuse: `IQualityGateConfig`, `IQualityThresholds` interfaces
  - Reuse: `QualityThresholdsDto` with class-validator decorators
  - Reuse: `QAResult` model for preview queries
  - Modify: `QualityGatesService.loadConfig()` to use database
- **Story 11.2: AI Decision Audit Logger** (Completed)
  - Use: `AIDecisionLoggerService` for config change tracking
- **Story 8.1: QA Review Queue** (Completed)
  - Follow: Same RBAC pattern (use `Role.QA` not `LEAD_QA`)
  - Follow: Same service/controller structure
- **Story 1.x: Project Module** - Project entity relations
- **Story 1.6: JWT Authentication** - RBAC enforcement

### Anti-Patterns to Avoid

| ❌ DO NOT                           | ✅ DO INSTEAD                             |
| ----------------------------------- | ----------------------------------------- |
| Create duplicate interfaces         | Import from Story 3.5                     |
| Use `LEAD_QA` role                  | Use `Role.QA` per Story 8.1               |
| Hard-code threshold defaults        | Align with Story 3.5 `DEFAULT_THRESHOLDS` |
| Skip cache invalidation             | Clear cache on config update              |
| Store history as individual columns | Use JSON snapshot pattern                 |
| Ignore env var migration            | Implement `seedGlobalDefaultsFromEnv()`   |

---

## References

- **PRD:** FR39 - Lead QA can define quality gates that must pass before human review
- **Story 3.5:** Quality Gate Decision Engine (interfaces, DTOs, DEFAULT_THRESHOLDS)
- **Story 8.1:** QA Review Queue & Sampling Configuration (RBAC pattern: use `Role.QA`)
- **Story 8.3:** Production Approval Workflow (uses quality gate results)
- **Story 11.2:** AI Decision Audit Logger (change tracking)
- **Architecture:** RBAC system (Story 1.6), Project Module

---

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Completion Notes List

### File List

**New Files:**

- `prisma/schema.prisma` (MODIFY: add QualityGateConfig, QualityGateConfigHistory)
- `src/qa-automation/quality-gate-config/dto/update-quality-gate-config.dto.ts`
- `src/qa-automation/quality-gate-config/dto/clone-config.dto.ts`
- `src/qa-automation/quality-gate-config/dto/config-preview.dto.ts`
- `src/qa-automation/quality-gate-config/dto/quality-gate-config-response.dto.ts`
- `src/qa-automation/quality-gate-config/interfaces/config-preview.interface.ts`
- `src/qa-automation/quality-gate-config/quality-gate-config.service.ts`
- `src/qa-automation/quality-gate-config/quality-gate-config.controller.ts`
- `src/qa-automation/quality-gate-config/quality-gate-config.module.ts`
- `src/qa-automation/quality-gate-config/quality-gate-config.service.spec.ts`
- `test/quality-gate-config.e2e-spec.ts`

**Modified Files:**

- `src/qa-automation/quality-gates/quality-gates.service.ts` (update loadConfig method)
- `src/qa-automation/qa-automation.module.ts` (import QualityGateConfigModule)
- `src/prisma/schema.prisma` (add new models)
- `src/prisma/models/index.ts` (export new models)

**Reused from Story 3.5 (DO NOT DUPLICATE):**

- `src/qa-automation/interfaces/quality-gate.interface.ts` (IQualityGateConfig, IQualityThresholds)
- `src/qa-automation/dto/quality-gate.dto.ts` (QualityThresholdsDto base validators)
