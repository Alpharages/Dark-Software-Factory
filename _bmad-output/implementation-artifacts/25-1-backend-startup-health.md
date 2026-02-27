# Story 25.1: Backend Startup Health

Status: done

## Story

As a DevOps Engineer,
I want the NestJS backend to start cleanly without errors or deprecation warnings,
so that the production environment is reliable and startup logs are free of misleading noise.

## Acceptance Criteria

1. No `ERROR` or `WARN` log entries appear for path-to-regexp, deprecated services, or Prisma record-not-found when running `pnpm run build` or `pnpm start:dev`
2. The `/api/*` wildcard route is renamed to `/api/*path` in whichever controller or middleware defines it (for path-to-regexp v8 compatibility)
3. `ActionableStatusService` class, its corresponding `.spec.ts` unit tests, and its module `providers`/`exports` registrations are deleted from the codebase.
4. All services and tests previously injecting `ActionableStatusService` now successfully inject and call `StatusEvaluationService` directly.
5. Base compilation `pnpm run build` and tests `pnpm run test` pass.
6. `PtyExecutionService` Prisma `update()` calls on startup/shutdown use `updateMany` to skip updates gracefully if the record does not exist without throwing.
7. Running `pnpm start:dev` emits zero ERROR/WARN lines related to these three issues.

## Tasks / Subtasks

- [x] Task 1: Fix path-to-regexp wildcard route (AC: 2)
  - [x] Locate `/api/*` route in controllers/middleware (likely in `AppController` or `ProxyController`)
  - [x] Rename path variable to `/api/*path`
- [x] Task 2: Completely Remove ActionableStatusService (AC: 3, 4, 5)
  - [x] Find all references and injections of `ActionableStatusService`
  - [x] Refactor dependent services to inject and use `StatusEvaluationService` instead
  - [x] Remove `ActionableStatusService` from its encompassing module context (`providers` and `exports`)
  - [x] Delete `actionable-status.service.ts` and `actionable-status.service.spec.ts`
  - [x] Update any broken unit tests in other services that mocked `ActionableStatusService`
- [x] Task 3: Fix PtyExecutionService Prisma record-not-found error (AC: 6)
  - [x] Locate `PtyExecutionService` (likely in `src/execution/` or similar)
  - [x] Find the `.update()` call on `execution` that fires during startup, teardown, or sync
  - [x] Refactor to use `updateMany({ where: { id: ... }, data })` to avoid Prisma NotFound exceptions entirely
- [x] Task 4: Validate compilation and clean startup (AC: 1, 5, 7)
  - [x] Run `pnpm run build` to verify module and DI health
  - [x] Run `pnpm run test` to verify no lingering test mocks fail
  - [x] Run `pnpm start:dev` and confirm no backend startup errors/warnings

## Dev Notes

### Technical Requirements & Anti-Patterns

- **Module Cleanup Guardrail**: Be vigilant when deleting services. You MUST remove the class from the module's `providers` array. Failing to do so breaks NestJS DI compilation.
- **Unit Test Hygiene**: Delete the `.spec.ts` alongside the service. You MUST also repair any neighboring tests that injected it.
- **Prisma Error Handling Guardrail**: **ANTI-PATTERN:** Do NOT wrap `findUnique` + `update` or use `try/catch` for this specific fix. **CORRECT:** Use `updateMany({ where: { id }, data })`. It returns `{ count: 0 }` if not found and safely circumvents the throw, saving query overhead without boilerplate.
- **Express / path-to-regexp**: The issue with `/api/*` is caused by Express/path-to-regexp `v8` requiring named wildcard parameters like `*path` instead of just `*`.

### Project Structure Notes

- `PtyExecutionService` is likely housed in `src/execution/` or `src/docker/`.
- `StatusEvaluationService` and `ActionableStatusService` are likely housed in `src/status/` or a shared module.
- The wildcard route `/api/*` might be in `src/app.controller.ts` or a proxy middleware.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 25.1]
- [Source: _bmad-output/planning-artifacts/architecture.md]

## Dev Agent Record

### Agent Model Used

BMad Base Model

### Debug Log References

None

### Completion Notes List

- Updated `app.module.ts` to use `*path` for the `CorrelationIdMiddleware` path configuration to resolve the path-to-regexp warning natively.
- Removed `ActionableStatusService` and `StatusEvaluationResult` exports. Replaced with references and DI injections pointing directly to `StatusEvaluationService`. Removed tests, module imports, and provider declarations.
- Updated `WebhooksService` and `webhooks.service.spec.ts` to properly mock and rely on `StatusEvaluationService`.
- Modified `ExecutionRepository.update` signature to use `this.prisma.execution.updateMany` inside to eliminate `record-not-found` Prisma errors when containers fail or when `assignContainer` is executed at startup. Both tests and the development server cleanly start up without `WARN`/`ERROR` logs regarding this issue.

### File List

- `src/app.module.ts`
- `src/webhooks/webhooks.service.ts`
- `src/webhooks/webhooks.module.ts`
- `src/webhooks/services/index.ts`
- `src/webhooks/webhooks.service.spec.ts`
- `src/ticket-intake/services/status-evaluation.service.ts`
- `src/execution/execution.repository.ts`
