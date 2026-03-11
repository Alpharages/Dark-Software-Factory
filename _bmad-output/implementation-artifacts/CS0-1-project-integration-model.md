# Story CS0.1: ProjectIntegration Model & Provider Enum

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the **DSF system**,
I want a provider-agnostic database model to store all PM tool connections,
so that ClickUp, Jira, and Asana connections share one consistent schema.

## Acceptance Criteria

1. An `IntegrationProvider` enum exists with values: `CLICKUP`, `JIRA`, `ASANA`.
2. A `ProjectIntegration` model exists with fields:
   - id: string (UUID, primary key)
   - project_id: string (foreign key to `Project`)
   - provider: enum (`CLICKUP` | `JIRA` | `ASANA`)
   - workspace_id: string
   - workspace_name: string
   - access_token: string? (encrypted)
   - refresh_token: string? (encrypted)
   - token_expiry: datetime?
   - bot_user_id: string?
   - bot_username: string?
   - polling_enabled: boolean
   - polling_interval_min: integer
   - polling_last_run_at: datetime?
   - webhook_enabled: boolean
   - webhook_id: string?
   - webhook_secret: string? (encrypted)
   - provider_config: JSON (for provider-specific IDs like list ID, board ID, project key)
   - ai_trigger_status: string? (optional)
   - created_at: datetime (default now)
   - updated_at: datetime (updatedAt)
3. access_token, refresh_token, and webhook_secret are stored encrypted via existing `EncryptionService`.
4. `@@unique([project_id, provider])` constraint exists — one connection per provider per project.
5. `Project` model has `integrations ProjectIntegration[]` relation.
6. A Prisma migration is generated and applied.
7. `pnpm typecheck` passes with zero errors.

## Tasks / Subtasks

- [x] Task 1: Update Prisma schema (AC: 1, 2, 4, 5)
  - [x] Add `IntegrationProvider` enum
  - [x] Add `ProjectIntegration` model with all required fields
  - [x] Add `integrations` relation to `Project` model
- [x] Task 2: Generate and apply Prisma migration (AC: 6)
  - [x] Run `npx prisma migrate dev --name init_project_integration`
- [x] Task 3: Implement/Verify Encryption for Tokens (AC: 3)
  - [x] Ensure any service interacting with `ProjectIntegration` tokens uses `EncryptionService` (imported from `src/common/encryption/encryption.service.ts`). Verify successful encryption/decryption using the standard `this.encryption.encrypt(token)` and `this.encryption.decrypt(encryptedToken)` pattern (reference `src/github/github-auth-flow.service.ts`). No plain text tokens should ever be stored.
- [x] Task 4: Verify Type Safety (AC: 7)
  - [x] Run `pnpm typecheck` to ensure no related errors.

## Dev Notes

- **Relevant architecture patterns and constraints:**
  - Database is PostgreSQL managed via Prisma. Ensure proper data types for PostgreSQL and Prisma are utilized (e.g. JSON datatype for provider_config).
  - Encryption relies on the existing `EncryptionService` to handle sensitive payload strings like `access_token`, `refresh_token`, and `webhook_secret`. Ensure tokens are not logged in plaintext.
- **Source tree components to touch:**
  - `prisma/schema.prisma`
  - Any auto-generated Prisma client types (`node_modules/.prisma/client`)
- **Testing standards summary:**
  - Provide corresponding unit tests for any service handling the encryption of the tokens in the `ProjectIntegration` model context.

### Project Structure Notes

- Alignment with unified project structure: `prisma/schema.prisma` must be modified.

### References

- [Source: docs/planning-artifacts/epics-clickup-smart-sync.md#Story 0.1: ProjectIntegration Model & Provider Enum]

## Dev Agent Record

### Agent Model Used

Antigravity

### Debug Log References

N/A

### Completion Notes List

- Added `IntegrationProvider` enum and `ProjectIntegration` model to Prisma schema with all AC-required fields, `@@unique([project_id, provider])` constraint, and `onDelete: Cascade` FK to `Project`.
- Generated migration `20260311111346_init_project_integration` creating the `project_integrations` table.
- Implemented `ProjectIntegrationService` with `createIntegration`, `updateIntegration`, `findByProjectAndProvider`, and `getDecryptedIntegration` — all read paths use a private `decryptTokens` helper with error context. Write paths encrypt before persisting and return plaintext to callers.
- Registered `ProjectIntegrationService` in `IntegrationsModule` with `EncryptionModule` and `DatabaseModule` imports.

### File List

- prisma/schema.prisma
- prisma/migrations/20260311111346_init_project_integration/migration.sql
- src/integrations/project-integration.service.ts
- src/integrations/project-integration.service.spec.ts
- src/integrations/integrations.module.ts
