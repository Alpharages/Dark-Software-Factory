# Story OS-4.5: AI Routing Configuration — Global Admin + PM Project Overrides

Status: ready-for-dev

## Change Log

- 2026-03-26: Story created. Captures the need to make hardcoded OS-4.4 routing parameters configurable through the platform UI at global (ADMIN) and project (PM) levels.

## Story

As a **PM / Admin**,
I want AI routing strategy parameters (complexity thresholds, provider-per-tier mapping, primary override) to be configurable through the platform UI rather than locked in environment variables,
So that Admins can set platform-wide defaults and PMs can tune routing behaviour for their specific project without requiring a deployment.

## Background & Motivation

OS-4.4 hard-wires the following in code/env:

| Parameter                              | Location                                     | Hardcoded default  |
| -------------------------------------- | -------------------------------------------- | ------------------ |
| Complexity threshold — MEDIUM boundary | `orchestrator.complexityThresholdMedium` env | `5`                |
| Complexity threshold — HIGH boundary   | `orchestrator.complexityThresholdHigh` env   | `10`               |
| Tier LOW → primary provider            | `provider-factory.service.ts:221`            | `KIMI`             |
| Tier LOW → fallback provider           | `provider-factory.service.ts:223`            | `CLAUDE_CODE`      |
| Tier MEDIUM → primary provider         | `provider-factory.service.ts:243`            | `CLAUDE_CODE`      |
| Tier MEDIUM → fallback provider        | `provider-factory.service.ts:245`            | `GEMINI`           |
| Tier HIGH → primary provider           | `provider-factory.service.ts:232`            | `CLAUDE_CODE`      |
| Tier HIGH → fallback provider          | `provider-factory.service.ts:234`            | `CODEX`            |
| Global primary override                | `AI_PRIMARY_PROVIDER` env                    | `''` (no override) |

There is no project-level granularity at all. A PM running a security-critical project may want all tickets routed to `CLAUDE_CODE` regardless of complexity; a PM with a high-volume simple-task project may want to pin their project to `KIMI` for cost reasons. Neither is possible today without an env change and redeploy.

This story adds a `AiRoutingConfig` Prisma model (mirroring the `QualityGateConfig` pattern already in the schema), a service with global/project merge resolution, REST endpoints with appropriate RBAC, and wires both `AIRoutingService` and `ProviderFactoryService` to read from DB config instead of raw env values.

Frontend UI is deferred to a separate story (OS-4.6-UI).

## Acceptance Criteria

1. **Given** a `AiRoutingConfig` Prisma model with `projectId: String? @unique` (null = global singleton, non-null = project-specific row)
   **When** `pnpm db:generate` runs
   **Then** the Prisma client includes `AiRoutingConfig` with all routing fields as nullable (project rows) or non-nullable-with-defaults (global row enforced at service layer)

2. **Given** no `AiRoutingConfig` row exists (fresh install)
   **When** `AiRoutingConfigService.getEffectiveConfig(projectId)` is called
   **Then** it returns the hardcoded fallback defaults (`complexityThresholdMedium=5`, `complexityThresholdHigh=10`, tier mappings as per OS-4.4) — system never throws on missing config

3. **Given** a global `AiRoutingConfig` row exists (projectId = null) with `complexityThresholdMedium=7`
   **And** no project-level row exists for project X
   **When** `getEffectiveConfig(projectX)` is called
   **Then** it returns `complexityThresholdMedium=7` (global value inherited)

4. **Given** a global row with `complexityThresholdMedium=7`
   **And** a project-level row for project X with `complexityThresholdMedium=3`
   **When** `getEffectiveConfig(projectX)` is called
   **Then** it returns `complexityThresholdMedium=3` (project value overrides global)

5. **Given** a project-level row for project X with `tierLowProvider=CLAUDE_CODE` but all other fields null
   **When** `getEffectiveConfig(projectX)` is called
   **Then** `tierLowProvider=CLAUDE_CODE` (project override) and all other fields resolve from the global row or hardcoded defaults

6. **Given** `PUT /api/v1/ai-routing/config/global` with a valid payload
   **When** called by a user with role `ADMIN`
   **Then** the global `AiRoutingConfig` row is upserted and a 200 response is returned

7. **Given** `PUT /api/v1/ai-routing/config/global`
   **When** called by a user with role `PM`, `TL`, `QA`, `MANAGER`, or `VIEWER`
   **Then** a 403 Forbidden response is returned

8. **Given** `PUT /api/v1/ai-routing/config/project/:projectId`
   **When** called by the PM assigned to that project (user's `project_id` matches or user has `VIEW_ALL_PROJECTS`)
   **Then** the project-level config row is upserted and a 200 response is returned

9. **Given** `PUT /api/v1/ai-routing/config/project/:projectId`
   **When** called by a PM who is not assigned to that project and does not have `VIEW_ALL_PROJECTS`
   **Then** a 403 Forbidden response is returned

10. **Given** `DELETE /api/v1/ai-routing/config/project/:projectId`
    **When** called by ADMIN or the owning PM
    **Then** the project-level config row is deleted (project reverts to global defaults) and a 200 response is returned

11. **Given** `AIRoutingService.routeTicket()` runs for a ticket in project X
    **When** `getEffectiveConfig(projectX)` returns `complexityThresholdMedium=3`
    **Then** a ticket with complexity score 4 routes to `CLAUDE_CODE` (above threshold), not `KIMI`

12. **Given** `ProviderFactoryService.selectProvider()` runs with `input.projectId = projectX`
    **When** the effective config for project X has `tierHighProvider=GEMINI`
    **Then** a high-complexity ticket in project X selects `GEMINI` as primary, not `CLAUDE_CODE`

13. **Given** `GET /api/v1/ai-routing/config/global`
    **When** called by ADMIN or MANAGER
    **Then** the current global config (or defaults if no row exists) is returned as structured JSON

14. **Given** `GET /api/v1/ai-routing/config/project/:projectId`
    **When** called by ADMIN, MANAGER, or the owning PM
    **Then** the project-level config (or empty object if no override row exists) is returned

15. **Given** `GET /api/v1/ai-routing/config/project/:projectId/effective`
    **When** called by ADMIN, MANAGER, or the owning PM
    **Then** the merged effective config (global + project overrides applied) is returned — useful for UI preview

16. **Given** `pnpm typecheck` and `pnpm test` are run after all changes
    **Then** zero TypeScript errors and zero test failures

## Tasks / Subtasks

- [ ] Task 1: Add `AiRoutingConfig` model to `prisma/schema.prisma` (AC: #1)
  - [ ] Add the model after the `QualityGateConfig` block (line ~970) as follows:

    ```prisma
    model AiRoutingConfig {
      id                          String      @id @default(uuid())
      projectId                   String?     @unique
      // Null projectId = global singleton. Non-null = project-level override.
      // All routing fields are nullable: null means "inherit from global / use hardcoded default".
      primaryProviderOverride     AIProvider?
      complexityThresholdMedium   Int?
      complexityThresholdHigh     Int?
      tierLowProvider             AIProvider?
      tierLowFallback             AIProvider?
      tierMediumProvider          AIProvider?
      tierMediumFallback          AIProvider?
      tierHighProvider            AIProvider?
      tierHighFallback            AIProvider?
      updatedById                 String
      createdAt                   DateTime    @default(now())
      updatedAt                   DateTime    @updatedAt
      project                     Project?    @relation(fields: [projectId], references: [id], onDelete: Cascade)
      updatedBy                   User        @relation("AiRoutingConfigUpdatedBy", fields: [updatedById], references: [id])

      @@index([projectId])
      @@map("ai_routing_configs")
    }
    ```

  - [ ] Add the reverse relation to `Project` model (after the `quality_gate_config` field):
    ```prisma
    ai_routing_config   AiRoutingConfig?
    ```
  - [ ] Add the reverse relation to `User` model for `AiRoutingConfigUpdatedBy` (follow the same pattern as `QualityGateConfigUpdatedBy` on the User model)
  - [ ] Run `pnpm db:migrate` to create the migration, name it `add_ai_routing_config`
  - [ ] Run `pnpm db:generate` to regenerate the Prisma client

- [ ] Task 2: Create `src/ai-routing/dto/ai-routing-config.dto.ts` (AC: #6, #8)
  - [ ] Define `UpdateGlobalAiRoutingConfigDto` with all fields optional (admin updates partial fields):

    ```typescript
    import { IsEnum, IsInt, IsOptional, Min, Max } from 'class-validator';
    import { ApiPropertyOptional } from '@nestjs/swagger';
    import { AIProvider } from '@/prisma/client';

    export class UpdateGlobalAiRoutingConfigDto {
      @ApiPropertyOptional({ enum: AIProvider })
      @IsOptional()
      @IsEnum(AIProvider)
      primaryProviderOverride?: AIProvider | null;

      @ApiPropertyOptional({ minimum: 1, maximum: 19 })
      @IsOptional()
      @IsInt()
      @Min(1)
      @Max(19)
      complexityThresholdMedium?: number;

      @ApiPropertyOptional({ minimum: 2, maximum: 20 })
      @IsOptional()
      @IsInt()
      @Min(2)
      @Max(20)
      complexityThresholdHigh?: number;

      @ApiPropertyOptional({ enum: AIProvider })
      @IsOptional()
      @IsEnum(AIProvider)
      tierLowProvider?: AIProvider;

      @ApiPropertyOptional({ enum: AIProvider })
      @IsOptional()
      @IsEnum(AIProvider)
      tierLowFallback?: AIProvider | null;

      @ApiPropertyOptional({ enum: AIProvider })
      @IsOptional()
      @IsEnum(AIProvider)
      tierMediumProvider?: AIProvider;

      @ApiPropertyOptional({ enum: AIProvider })
      @IsOptional()
      @IsEnum(AIProvider)
      tierMediumFallback?: AIProvider | null;

      @ApiPropertyOptional({ enum: AIProvider })
      @IsOptional()
      @IsEnum(AIProvider)
      tierHighProvider?: AIProvider;

      @ApiPropertyOptional({ enum: AIProvider })
      @IsOptional()
      @IsEnum(AIProvider)
      tierHighFallback?: AIProvider | null;
    }
    ```

  - [ ] Define `UpdateProjectAiRoutingConfigDto` — identical shape (all fields optional including null to clear an override):
    ```typescript
    export class UpdateProjectAiRoutingConfigDto extends UpdateGlobalAiRoutingConfigDto {}
    ```
  - [ ] Define `EffectiveAiRoutingConfigDto` (response shape — all fields resolved, never null except primaryProviderOverride):
    ```typescript
    export class EffectiveAiRoutingConfigDto {
      primaryProviderOverride: AIProvider | null;
      complexityThresholdMedium: number;
      complexityThresholdHigh: number;
      tierLowProvider: AIProvider;
      tierLowFallback: AIProvider | null;
      tierMediumProvider: AIProvider;
      tierMediumFallback: AIProvider | null;
      tierHighProvider: AIProvider;
      tierHighFallback: AIProvider | null;
    }
    ```
  - [ ] Export all three from a barrel `src/ai-routing/dto/index.ts`

- [ ] Task 3: Create `src/ai-routing/ai-routing-config.service.ts` (AC: #2, #3, #4, #5, #6, #8, #10)
  - [ ] `@Injectable()` class `AiRoutingConfigService`
  - [ ] Inject `PrismaService`
  - [ ] Define `HARDCODED_DEFAULTS` as a private `readonly` constant (these are the last-resort values if no DB row exists):
    ```typescript
    private readonly DEFAULTS: EffectiveAiRoutingConfigDto = {
      primaryProviderOverride: null,
      complexityThresholdMedium: 5,
      complexityThresholdHigh: 10,
      tierLowProvider: AIProvider.KIMI,
      tierLowFallback: AIProvider.CLAUDE_CODE,
      tierMediumProvider: AIProvider.CLAUDE_CODE,
      tierMediumFallback: AIProvider.GEMINI,
      tierHighProvider: AIProvider.CLAUDE_CODE,
      tierHighFallback: AIProvider.CODEX,
    };
    ```
  - [ ] Implement `getGlobalConfig(): Promise<AiRoutingConfig | null>` — `findUnique({ where: { projectId: null } })`
  - [ ] Implement `getProjectConfig(projectId: string): Promise<AiRoutingConfig | null>` — `findUnique({ where: { projectId } })`
  - [ ] Implement `getEffectiveConfig(projectId?: string): Promise<EffectiveAiRoutingConfigDto>`:

    ```typescript
    async getEffectiveConfig(projectId?: string): Promise<EffectiveAiRoutingConfigDto> {
      const [globalRow, projectRow] = await Promise.all([
        this.prisma.aiRoutingConfig.findUnique({ where: { projectId: null } }),
        projectId
          ? this.prisma.aiRoutingConfig.findUnique({ where: { projectId } })
          : Promise.resolve(null),
      ]);

      // Three-level merge: DEFAULTS ← globalRow ← projectRow (rightmost wins if non-null)
      const merge = (
        field: keyof EffectiveAiRoutingConfigDto,
      ) =>
        projectRow?.[field as keyof typeof projectRow] ??
        globalRow?.[field as keyof typeof globalRow] ??
        this.DEFAULTS[field];

      return {
        primaryProviderOverride: merge('primaryProviderOverride') as AIProvider | null,
        complexityThresholdMedium: merge('complexityThresholdMedium') as number,
        complexityThresholdHigh: merge('complexityThresholdHigh') as number,
        tierLowProvider: merge('tierLowProvider') as AIProvider,
        tierLowFallback: merge('tierLowFallback') as AIProvider | null,
        tierMediumProvider: merge('tierMediumProvider') as AIProvider,
        tierMediumFallback: merge('tierMediumFallback') as AIProvider | null,
        tierHighProvider: merge('tierHighProvider') as AIProvider,
        tierHighFallback: merge('tierHighFallback') as AIProvider | null,
      };
    }
    ```

  - [ ] Implement `upsertGlobalConfig(dto: UpdateGlobalAiRoutingConfigDto, updatedById: string): Promise<AiRoutingConfig>`:
    - `upsert({ where: { projectId: null }, update: { ...dto, updatedById }, create: { projectId: null, ...applyDefaults(dto), updatedById } })`
    - `applyDefaults` fills any undefined field with `DEFAULTS` value so the global row is always fully populated
  - [ ] Implement `upsertProjectConfig(projectId: string, dto: UpdateProjectAiRoutingConfigDto, updatedById: string): Promise<AiRoutingConfig>`:
    - `upsert({ where: { projectId }, update: { ...dto, updatedById }, create: { projectId, ...dto, updatedById } })`
    - Fields left undefined/null are stored as null (meaning "inherit from global")
  - [ ] Implement `deleteProjectConfig(projectId: string): Promise<void>`:
    - `deleteMany({ where: { projectId } })` (deleteMany avoids throwing if row not found)

- [ ] Task 4: Create `src/ai-routing/ai-routing-config.controller.ts` (AC: #6, #7, #8, #9, #10, #13, #14, #15)
  - [ ] `@ApiTags('AI Routing Config')`, `@ApiBearerAuth()`, `@Controller('ai-routing/config')`, `@UseGuards(JwtAuthGuard, RolesGuard, ThrottlerGuard)`
  - [ ] Inject `AiRoutingConfigService`
  - [ ] `GET /global` — `@Roles(Role.ADMIN, Role.MANAGER)` — returns `getGlobalConfig()` or `DEFAULTS` if null
  - [ ] `PUT /global` — `@Roles(Role.ADMIN)` — calls `upsertGlobalConfig(dto, userId)`
  - [ ] `GET /project/:projectId` — `@Roles(Role.ADMIN, Role.MANAGER, Role.PM)` — returns `getProjectConfig(projectId)` (PM ownership check in service)
  - [ ] `PUT /project/:projectId` — `@Roles(Role.ADMIN, Role.MANAGER, Role.PM)` — calls `upsertProjectConfig(projectId, dto, userId)` (PM ownership check below)
  - [ ] `DELETE /project/:projectId` — `@Roles(Role.ADMIN, Role.MANAGER, Role.PM)` — calls `deleteProjectConfig(projectId)` (PM ownership check below)
  - [ ] `GET /project/:projectId/effective` — `@Roles(Role.ADMIN, Role.MANAGER, Role.PM)` — calls `getEffectiveConfig(projectId)`
  - [ ] **PM ownership check** — for `PUT` and `DELETE` on project config: if caller role is `PM`, verify `req.user.projectId === projectId` OR user has `VIEW_ALL_PROJECTS` permission. If neither, throw `ForbiddenException`. Follow the same guard pattern used in `QualityGateConfig` controller (check `src/qa-automation/` for the pattern).
  - [ ] Use `@Req() req: Request` to extract `userId = (req as any).user?.sub` (same pattern as `SystemConfigController`)

- [ ] Task 5: Register `AiRoutingConfigService` and `AiRoutingConfigController` in `AIRoutingModule` (AC: #16)
  - [ ] Open `src/ai-routing/ai-routing.module.ts`
  - [ ] Import `AiRoutingConfigService` from `./ai-routing-config.service`
  - [ ] Import `AiRoutingConfigController` from `./ai-routing-config.controller`
  - [ ] Add `AiRoutingConfigService` to `providers: [...]` array and `exports: [...]`
  - [ ] Add `AiRoutingConfigController` to `controllers: [...]` array
  - [ ] **Do NOT add DatabaseModule** — `PrismaService` is already available via the existing module imports

- [ ] Task 6: Wire `AIRoutingService` to consume `AiRoutingConfigService` (AC: #11)
  - [ ] Open `src/ai-routing/ai-routing.service.ts`
  - [ ] Add `AiRoutingConfigService` as a constructor injection parameter (after existing params, before metrics)
  - [ ] In `routeTicket()`, replace the current config reads:
    ```typescript
    // BEFORE (OS-4.4 pattern — reads from env-backed ConfigService):
    const mediumThreshold = this.configService.get<number>(
      'orchestrator.complexityThresholdMedium',
      5,
    );
    const highThreshold = this.configService.get<number>(
      'orchestrator.complexityThresholdHigh',
      10,
    );
    const kimiEnabled = this.configService.get<boolean>('ai.providers.kimi.enabled', false);
    const primaryOverride = this.configService.get<string>('ai.routing.primaryProvider', '');
    ```
    ```typescript
    // AFTER (OS-4.5 — reads from DB config with global/project merge):
    const routingConfig = await this.aiRoutingConfigService.getEffectiveConfig(request.projectId);
    const mediumThreshold = routingConfig.complexityThresholdMedium;
    const highThreshold = routingConfig.complexityThresholdHigh;
    const primaryOverride = routingConfig.primaryProviderOverride ?? '';
    ```
  - [ ] **[C1] Add `projectId` to the `selectProvider()` call** — currently `AIRoutingService.routeTicket()` calls `this.providerFactory.selectProvider({...})` at line 76–85 but does NOT pass `projectId`. Without this, `ProviderFactoryService` will call `getEffectiveConfig(undefined)` and always use global config, ignoring project-level overrides. Add `projectId: request.projectId` to the call object:
    ```typescript
    const selection = await this.providerFactory.selectProvider({
      correlationId,
      ticketId,
      executionId: '',
      prompt: request.description,
      repositoryUrl: project.github_repository_url,
      title: request.title,
      acceptanceCriteria: request.acceptanceCriteria,
      tags: request.tags,
      projectId: request.projectId, // ← required for project-level config lookup
    });
    ```
  - [ ] Update the complexity tier selection to use `routingConfig.tierLowProvider` instead of `AIProvider.KIMI`:
    ```typescript
    } else if (complexityScore < mediumThreshold && kimiEnabled) {
      preferredProvider = AIProvider.KIMI;
    ```
    becomes:
    ```typescript
    } else if (complexityScore < mediumThreshold) {
      preferredProvider = routingConfig.tierLowProvider;
    ```
  - [ ] Remove the `kimiEnabled` config read — the tier provider from DB config IS the routing decision. If the PM set `tierLowProvider=KIMI`, KIMI is the preference; `ProviderHealthService.getAvailableProvider()` will still fall back naturally if KIMI is unhealthy/disabled.
  - [ ] **Keep** the `claudeEnabled` guard check (throw if CLAUDE_CODE not enabled) — that is a hard system constraint, not a configurable preference
  - [ ] **Do NOT change** the lock acquisition, execution creation, or queue publishing logic

- [ ] Task 7: Wire `ProviderFactoryService` to consume `AiRoutingConfigService` (AC: #12)
  - [ ] Open `src/ai-routing/provider-factory.service.ts`
  - [ ] Add `AiRoutingConfigService` as a constructor injection parameter
  - [ ] Remove the constructor-time threshold assignments:
    ```typescript
    // REMOVE these two lines:
    this.HIGH_COMPLEXITY_THRESHOLD = this.config.get<number>(
      'orchestrator.complexityThresholdHigh',
      10,
    );
    this.MEDIUM_COMPLEXITY_THRESHOLD = this.config.get<number>(
      'orchestrator.complexityThresholdMedium',
      5,
    );
    ```
    (The thresholds are now read per-request from `AiRoutingConfigService`)
  - [ ] Remove the `private readonly HIGH_COMPLEXITY_THRESHOLD: number` and `MEDIUM_COMPLEXITY_THRESHOLD: number` class fields
  - [ ] Update `selectProvider()` to fetch effective config:

    ```typescript
    async selectProvider(input: IOrchestrationInput): Promise<IProviderSelection> {
      const { correlationId, providerOverride, preCalculatedComplexity } = input;
      const routingConfig = await this.aiRoutingConfigService.getEffectiveConfig(input.projectId);

      // Override: input-level takes precedence, then DB config override, then complexity strategy
      const finalOverride =
        providerOverride ||
        routingConfig.primaryProviderOverride ||
        null;
      // ... rest of method unchanged, but replace config.get threshold calls with routingConfig fields
    }
    ```

  - [ ] Update `getComplexityGrade()` to accept thresholds as parameters (so it can use the per-request config values):
    ```typescript
    private getComplexityGrade(
      score: number,
      mediumThreshold: number,
      highThreshold: number,
    ): ComplexityGrade { ... }
    ```
    Call it: `this.getComplexityGrade(complexityScore, routingConfig.complexityThresholdMedium, routingConfig.complexityThresholdHigh)`
  - [ ] Update `selectByComplexityAndAvailability()` to accept `routingConfig: EffectiveAiRoutingConfigDto` as a parameter instead of reading from `this.config`:
    ```typescript
    private selectByComplexityAndAvailability(
      correlationId: string,
      score: number,
      grade: ComplexityGrade,
      claudeAvailable: boolean,
      routingConfig: EffectiveAiRoutingConfigDto,   // ← new
    ): IProviderSelection {
      // Replace hardcoded AIProvider.KIMI/GEMINI/CODEX with routingConfig.tierLow/Medium/HighProvider
      // Replace this.config.get('ai.providers.*.enabled') checks with: provider is "enabled" if
      //   ProviderHealthService can reach it — config-enabled checks remain as a guard but
      //   the TIER SELECTION now uses routingConfig tier fields directly.
    }
    ```
  - [ ] Update `getFallbackFor()` to also accept `routingConfig` so it returns `routingConfig.tierLowFallback` etc. instead of hardcoded values
  - [ ] Pass `routingConfig` through from `selectProvider()` to both `selectByComplexityAndAvailability()` and `getFallbackFor()`

- [ ] Task 8: Add seed data for default global config row (AC: #2)
  - [ ] Open `prisma/seed.ts`
  - [ ] Find where `SystemConfig` or `QualityGateConfig` seeds are added (follow the existing pattern)
  - [ ] Add an upsert for the global `AiRoutingConfig` row with the OS-4.4 defaults:
    ```typescript
    await prisma.aiRoutingConfig.upsert({
      where: { projectId: null },
      update: {}, // don't overwrite existing admin customisations on re-seed
      create: {
        projectId: null,
        primaryProviderOverride: null,
        complexityThresholdMedium: 5,
        complexityThresholdHigh: 10,
        tierLowProvider: 'KIMI',
        tierLowFallback: 'CLAUDE_CODE',
        tierMediumProvider: 'CLAUDE_CODE',
        tierMediumFallback: 'GEMINI',
        tierHighProvider: 'CLAUDE_CODE',
        tierHighFallback: 'CODEX',
        updatedById: adminUser.id, // use the seeded admin user id
      },
    });
    ```
  - [ ] **Note:** `update: {}` intentionally — seed should never overwrite admin customisations on re-run

- [ ] Task 9: Write unit tests `src/ai-routing/ai-routing-config.service.spec.ts` (AC: #16)
  - [ ] Mock `PrismaService` with `aiRoutingConfig.findUnique`, `aiRoutingConfig.upsert`, `aiRoutingConfig.deleteMany`
  - [ ] Test cases required:
    - `getEffectiveConfig()` — no rows in DB → returns `DEFAULTS`
    - `getEffectiveConfig()` — global row only → global values applied over defaults
    - `getEffectiveConfig(projectId)` — global row + project row → project fields win over global
    - `getEffectiveConfig(projectId)` — project row with some fields null → null fields inherit global
    - `getEffectiveConfig(projectId)` — project row with all fields null → all fields from global/defaults
    - `upsertGlobalConfig(dto, userId)` — calls prisma.upsert with `projectId: null`
    - `upsertProjectConfig(projectId, dto, userId)` — calls prisma.upsert with correct projectId
    - `deleteProjectConfig(projectId)` — calls prisma.deleteMany
    - Threshold validation: `complexityThresholdHigh` must be > `complexityThresholdMedium` (add guard in service and test it throws if violated)

- [ ] Task 10: Update `ai-routing.service.spec.ts` for config service injection (AC: #16)
  - [ ] Add mock `AiRoutingConfigService` to the test module:
    ```typescript
    {
      provide: AiRoutingConfigService,
      useValue: {
        getEffectiveConfig: jest.fn().mockResolvedValue({
          primaryProviderOverride: null,
          complexityThresholdMedium: 5,
          complexityThresholdHigh: 10,
          tierLowProvider: AIProvider.KIMI,
          tierLowFallback: AIProvider.CLAUDE_CODE,
          tierMediumProvider: AIProvider.CLAUDE_CODE,
          tierMediumFallback: AIProvider.GEMINI,
          tierHighProvider: AIProvider.CLAUDE_CODE,
          tierHighFallback: AIProvider.CODEX,
        }),
      },
    },
    ```
  - [ ] Existing routing tests remain valid — verify they still pass with the mock returning defaults
  - [ ] Add new test: overriding `tierLowProvider=CLAUDE_CODE` via mock → low-complexity ticket routes to `CLAUDE_CODE`
  - [ ] Add new test: `primaryProviderOverride=GEMINI` via mock → all tiers select `GEMINI` as preferred

- [ ] Task 11: Update `provider-factory.service.spec.ts` for config service injection (AC: #16)
  - [ ] Add mock `AiRoutingConfigService` (same mock shape as Task 10)
  - [ ] Update `selectProvider` and `selectByComplexityAndAvailability` tests to verify they read tier config from `AiRoutingConfigService.getEffectiveConfig()`, not hardcoded values
  - [ ] Add test: `tierHighProvider=GEMINI` in effective config → HIGH grade selects `GEMINI` as primary

- [ ] Task 12: Final verification (AC: #16)
  - [ ] `pnpm db:migrate` → clean migration, no errors
  - [ ] `pnpm db:generate` → client regenerated
  - [ ] `pnpm typecheck` → zero errors
  - [ ] `pnpm test src/ai-routing/ai-routing-config.service.spec.ts` → all pass
  - [ ] `pnpm test src/ai-routing/ai-routing.service.spec.ts` → all pass
  - [ ] `pnpm test src/ai-routing/provider-factory.service.spec.ts` → all pass
  - [ ] `pnpm test` → zero failures across all tests

## Dev Notes

### Precedent: `QualityGateConfig` Pattern

This story deliberately mirrors `QualityGateConfig` (`prisma/schema.prisma:945`), which is the established pattern for project-level configuration overrides in this codebase:

- `projectId: String? @unique` — null = global singleton, non-null = project-specific
- All fields nullable so project rows only store what was explicitly overridden
- Resolution handled in service layer (not Prisma defaults) for full three-level merge

Study `QualityGateConfig` and its service before implementing.

### Three-Level Merge Precedence

```
HARDCODED_DEFAULTS (code constants)
    ↑ overridden by
globalRow (AiRoutingConfig where projectId = null)
    ↑ overridden by
projectRow (AiRoutingConfig where projectId = X)
```

Only non-null DB values override. A project row field left as `null` means "inherit from the level below". This allows PMs to override only the fields they care about.

### Why Remove `kimiEnabled` Check from `AIRoutingService`

OS-4.4 gated `tierLowProvider = KIMI` selection behind `kimiEnabled` (env flag). With DB config, the PM explicitly chose `tierLowProvider = KIMI` in the UI — that IS the authorisation. The `ProviderHealthService.getAvailableProvider()` call immediately after still performs a live health check and falls back if KIMI is unhealthy or its circuit is open. Double-gating on env flags adds no safety but does add confusion.

The `CLAUDE_CODE_ENABLED` guard remains because Claude Code is the system's guaranteed fallback — if it's disabled, the system cannot safely route any ticket.

### `projectId` Threading in `ProviderFactoryService`

`IOrchestrationInput` already has `projectId` as a field (check `src/ai-routing/interfaces/orchestration.interface.ts`). Verify it is non-null when `OrchestratorService.execute()` calls `selectProvider()`. If `projectId` is missing on any call path, `getEffectiveConfig(undefined)` gracefully returns global config — no crash.

### Controller: PM Project Ownership Check

The `GET /project/:projectId` and `PUT /project/:projectId` endpoints need a project ownership guard. The correct pattern is:

```typescript
// In controller — extract role + id from JWT, check ownership
const user = (req as any).user;
if (user.role === Role.PM) {
  const project = await this.prisma.project.findUnique({ where: { id: projectId } });
  if (!project || project.pm_id !== user.sub) {
    throw new ForbiddenException('You do not own this project');
  }
}
// ADMIN and MANAGER bypass this check (VIEW_ALL_PROJECTS)
```

`Project.pm_id` is already set on every project record — no new fields needed.

### Threshold Validation Rule

`complexityThresholdHigh` must always be > `complexityThresholdMedium`. Enforce in `AiRoutingConfigService.upsertGlobalConfig()` and `upsertProjectConfig()`:

```typescript
if (dto.complexityThresholdHigh !== undefined && dto.complexityThresholdMedium !== undefined) {
  if (dto.complexityThresholdHigh <= dto.complexityThresholdMedium) {
    throw new BadRequestException(
      'complexityThresholdHigh must be greater than complexityThresholdMedium',
    );
  }
}
```

Also validate when only one threshold is provided by fetching the current effective config for the other value.

### Performance: No Caching Required in MVP

`getEffectiveConfig()` fires two `findUnique` queries in parallel (`Promise.all`). These are PK lookups (indexed). For MVP this is acceptable. A Redis cache with 5-minute TTL is a sensible follow-up (OS-5 or later) if query volume warrants it.

### `IOrchestrationInput.projectId` — Verify It Is Populated

Before calling `selectProvider()`, check that `OrchestratorService.execute()` populates `input.projectId`. If the execution record has a `project_id`, that should be threaded through. If `projectId` is missing from `IOrchestrationInput`, add it — the field likely already exists but may not be set at the call site.

### Config Keys No Longer Needed (Do NOT Delete Yet)

These env-backed config keys become redundant after this story:

- `orchestrator.complexityThresholdHigh`
- `orchestrator.complexityThresholdMedium`
- `ai.routing.primaryProvider`

**Do NOT remove them from `configuration.ts` or `env.validation.ts` in this story.** The `AiRoutingConfigService.DEFAULTS` currently mirrors those values. The env vars serve as documented precedent. Cleanup of dead env vars is scoped to OS-5.1.

### Files Created / Modified

| File                                               | Change                                          |
| -------------------------------------------------- | ----------------------------------------------- |
| `prisma/schema.prisma`                             | Add `AiRoutingConfig` model + reverse relations |
| `prisma/migrations/…add_ai_routing_config/`        | Auto-generated migration                        |
| `prisma/seed.ts`                                   | Seed default global config row                  |
| `src/ai-routing/dto/ai-routing-config.dto.ts`      | New: request/response DTOs                      |
| `src/ai-routing/dto/index.ts`                      | New or update: barrel export                    |
| `src/ai-routing/ai-routing-config.service.ts`      | New                                             |
| `src/ai-routing/ai-routing-config.service.spec.ts` | New                                             |
| `src/ai-routing/ai-routing-config.controller.ts`   | New                                             |
| `src/ai-routing/ai-routing.module.ts`              | Register service + controller                   |
| `src/ai-routing/ai-routing.service.ts`             | Inject + use `AiRoutingConfigService`           |
| `src/ai-routing/provider-factory.service.ts`       | Inject + use `AiRoutingConfigService`           |
| `src/ai-routing/ai-routing.service.spec.ts`        | Add mock + new test cases                       |
| `src/ai-routing/provider-factory.service.spec.ts`  | Add mock + new test cases                       |

No changes to: `ProviderHealthService`, `ComplexityScorerService`, `PromptGeneratorService`, `OrchestratorService` (beyond verifying `projectId` is threaded).

Always use `@/` import aliases — never relative paths.

### Scope Boundaries — What NOT to Change

- **Do NOT** build the frontend UI — that is OS-4.6-UI (separate story)
- **Do NOT** add Redis caching — deferred to OS-5 if needed
- **Do NOT** delete env var config keys — deferred to OS-5.1
- **Do NOT** change `ProviderHealthService` — it already supports all 4 providers
- **Do NOT** change complexity scoring logic — only the threshold reads move to DB config
- **Do NOT** add audit log for config changes in this story — the `updatedById` + `updatedAt` fields on the model are sufficient for MVP traceability

### References

- `QualityGateConfig` model (precedent): `prisma/schema.prisma:945`
- `SystemConfigController` (RBAC pattern): `src/system-settings/system-config.controller.ts`
- `AIRoutingService.routeTicket()` (routing logic to update): `src/ai-routing/ai-routing.service.ts:78–118`
- `ProviderFactoryService.selectByComplexityAndAvailability()` (tier logic to update): `src/ai-routing/provider-factory.service.ts:174–213`
- `IOrchestrationInput` (verify `projectId` field): `src/ai-routing/interfaces/orchestration.interface.ts`
- `Role` enum + `ROLE_PERMISSIONS`: `src/auth/constants/roles.enum.ts`
- OS-4.4 story (routing thresholds being replaced): `_bmad-output/implementation-artifacts/os-4-4-multi-provider-ai-routing-service-complexity-strategy.md`
- Epic OS-4 spec: `_bmad-output/planning-artifacts/epics.md`

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

### Review Findings
