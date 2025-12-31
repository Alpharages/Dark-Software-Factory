# Story 7.1: Architecture Decision Records (ADR) Generation

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the system,
I want AI to document its architecture decisions in ADR format,
so that TLs can review the reasoning behind technical choices.

## Acceptance Criteria

1. **Given** AI makes an architecture decision during code generation
   **When** the decision is significant (new dependencies, design patterns, infrastructure changes)
   **Then** an ADR is created with:
   - **Title:** Short descriptive name (e.g., "Use Redis for Session Storage")
   - **Status:** Proposed (awaiting TL review)
   - **Context:** Why this decision is needed
   - **Decision:** What was chosen
   - **Consequences:** Positive and negative impacts
   - **Alternatives Considered:** Other options AI evaluated
   - **AI Confidence:** How certain AI is about this choice
   - **Risk Level:** Calculated risk (High/Medium/Low) based on impact and confidence

2. **And** ADR is stored in database (`adrs` table in Prisma schema)
3. **And** ADR is linked to execution and ticket
4. **And** ADR follows standard ADR format (Michael Nygard template)
5. **And** ADR generation is DELEGATED to the AI provider via prompt instructions (per ADR-008)

## Tasks / Subtasks

- [x] Task 1: Database Schema Update (AC: #2, #3)
  - [x] Define `Adr` model in `schema.prisma` with fields: title, status, context, decision, consequences, alternatives, confidence, risk_level
  - [x] Add relations to `Execution` and `Ticket` models
  - [x] Generate Prisma migration and apply it
- [x] Task 2: Service & DTO Implementation (AC: #2)
  - [x] Create `AdrService` for basic CRUD operations
  - [x] Define `CreateAdrDto` and `UpdateAdrDto`
  - [x] Implement `MetricsService` integration to track ADR creation
- [x] Task 3: AI Prompt Enhancement (AC: #1, #4, #5)
  - [x] Update `PromptGeneratorService` to include ADR instructions in system prompt
  - [x] Define JSON schema for ADR output (`AdrSchema`) to ensure structured data matches `CreateAdrDto`
  - [x] Add rules for "When to generate ADR" (schema changes, new libs, etc.) in the system prompt
- [x] Task 4: AI Output Parsing & Storage (AC: #1, #5)
  - [x] Update `AiRoutingService` or `ExecutionService` to parse ADRs from AI response
  - [x] Integrate with `AdrService` to save parsed ADRs
  - [x] Implement `calculateRiskLevel(adr: CreateAdrDto): string` in `AdrService`
    - [x] Logic: High if `new_dependencies` or `schema_changes`; Medium if `refactoring`; Low otherwise
    - [x] Fallback to AI-provided risk level if available

## Dev Notes

- **Delegation Strategy (ADR-008):** This story leverages the High-ROI delegation pattern. Instead of building complex parsers to detect architecture changes, we explicitly **ask the AI** to output an ADR JSON object when it makes significant decisions.
- **V3 Enhancement:** Leverage `AIDecisionLogger` (Epic 11.2) if applicable. `AIDecisionLog` tracks *all* agent actions, while `Adr` tracks *significant architecture choices* requiring human review.
  - **Relation:** An `Adr` may be linked to the `AIDecisionLog` entry that created it (add `decision_log_id` to Adr model if feasible).

### Architecture Compliance

- **Module:** `architecture-review` (New Module)
- **Database:** New `Adr` model in PostgreSQL
- **Pattern:** Service-Repository pattern
- **Security:** RBAC for accessing ADRs (TL/Admin can approve, Dev can view)

### Project Structure Notes

- New module `src/architecture-review/` should contain `AdrService`, `AdrController` (if needed later, or generic CRUD now).
- Update `src/ai-routing/` to handle prompt injection and parsing.

### References

- [Source: docs/epics.md#Story 7.1](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/docs/epics.md)
- [Source: docs/architecture/epic-5-10-delegation-strategy.md](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/docs/architecture/epic-5-10-delegation-strategy.md)
- Standard ADR Format: https://adr.github.io/m.nygard/

## Dev Agent Record

### Agent Model Used

Antigravity (simulated via Create-Story Workflow)

### Debug Log References

N/A

### Completion Notes List

- [x] Schema updated with ADR model, relations, and enums
- [x] Service implementation with CRUD operations
- [x] Risk calculation logic implemented and tested
- [x] Prompt enhancement with ADR JSON schema in both Cursor and Claude templates
- [x] Integration with AI routing module complete
- [x] All unit tests passing (27/27)
- [x] CODE REVIEW REMEDIATION (2025-12-31): Fixed 8 CRITICAL issues
  - Integrated `AdrParserService` into `OrchestratorService.execute()` and `executeTask()` methods
  - ADRs are now parsed from AI responses and saved to database (AC#1, AC#5)
  - Added `ArchitectureReviewModule` to `AppModule` for global availability (CRITICAL fix)
  - Registered Prometheus `adr_creation_total` metric with `risk_level` label
  - Committed migration file `20251231162213_add_adr_model` to git
  - Non-blocking error handling ensures ADR parsing failures don't crash executions

### File List

- [NEW] src/architecture-review/architecture-review.module.ts
- [NEW] src/architecture-review/adr.service.ts
- [NEW] src/architecture-review/adr.service.spec.ts
- [NEW] src/architecture-review/dto/create-adr.dto.ts
- [NEW] src/architecture-review/dto/update-adr.dto.ts
- [NEW] src/architecture-review/dto/index.ts
- [NEW] src/ai-routing/adr-parser.service.ts
- [NEW] src/ai-routing/adr-parser.service.spec.ts
- [MODIFY] src/ai-routing/prompt-templates/cursor-prompt.template.ts
- [MODIFY] src/ai-routing/prompt-templates/claude-prompt.template.ts
- [MODIFY] src/ai-routing/ai-routing.module.ts
- [MODIFY] src/ai-routing/orchestrator.service.ts (CODE REVIEW FIX)
- [MODIFY] src/app.module.ts (CODE REVIEW FIX)
- [MODIFY] prisma/schema.prisma
- [NEW] prisma/migrations/20251231162213_add_adr_model/migration.sql
- [MODIFY] src/prisma/*.ts (auto-generated Prisma client files)
- [MODIFY] _bmad-output/implementation-artifacts/sprint-status.yaml
- [MODIFY] _bmad-output/implementation-artifacts/7-1-architecture-decision-records-adr-generation.md

### Change Log

- **2025-12-31 17:00 UTC**: Initial implementation completed (schema, services, DTOs, parser, prompts, tests)
- **2025-12-31 23:05 UTC**: CODE REVIEW REMEDIATION - Fixed 8 CRITICAL issues identified during adversarial review:
  - C1/C2: Integrated `AdrParserService` and `AdrService` into `OrchestratorService` - ADRs now parsed and saved
  - C3/C4: Fixed FALSE completion claims - integration is now real
  - C5: Added `adr_creation_total` Prometheus metric
  - C6: Added `ArchitectureReviewModule` to `AppModule.imports` - DI now working
  - C7: Committed migration `20251231162213_add_adr_model` to git
  - C8: Implemented non-blocking error handling (try/catch with logging)
  - Build: ✅ PASSING after all fixes
