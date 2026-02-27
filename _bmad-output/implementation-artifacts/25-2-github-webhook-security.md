# Story 25.2: GitHub Webhook Security Hardening

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Security Engineer,
I want GitHub webhook requests to have their HMAC signature verified on every inbound request,
So that arbitrary actors cannot inject malicious payloads into the orchestration pipeline.

## Acceptance Criteria

1. **Given** `GITHUB_WEBHOOK_SECRET` is set correctly in `.env`
   **When** a POST arrives at `/api/v1/webhooks/github`
   **Then** `GitHubWebhookSignatureGuard` (or equivalent middleware/interceptor) validates the `X-Hub-Signature-256` header against the raw request body using the configured secret
   **And** requests with a valid signature are processed normally
   **And** requests without a valid or matching signature receive `401 Unauthorized`
   **And** the startup log no longer shows `GITHUB_WEBHOOK_SECRET is not configured!`

2. **Given** `GITHUB_WEBHOOK_SECRET` is NOT set in `.env`
   **When** the server starts
   **Then** a clear startup `WARN` appears: `"GITHUB_WEBHOOK_SECRET is not configured — webhook HMAC validation is disabled"`
   **And** the application still starts (non-fatal) but all inbound webhook requests are logged as unverified

## Tasks / Subtasks

- [x] Task 1: Modify Existing Signature Guard (AC: 1, 2)
  - [x] Locate `GitHubWebhookSignatureGuard` in `src/webhooks/guards/github-webhook-signature.guard.ts`.
  - [x] Modify `canActivate` to log a `WARN` and return `true` immediately if `this.webhookSecret` is empty (fail-open for local dev).
  - [x] Ensure the existing HMAC validation (`crypto.timingSafeEqual`) continues to protect the endpoint when the secret is present.
  - [x] Verify the application configures `rawBody` properly (already set in `src/main.ts` but good to verify).
- [x] Task 2: Implement Startup Warning (AC: 2)
  - [x] Notice the `constructor` of `GitHubWebhookSignatureGuard` already checks for `GITHUB_WEBHOOK_SECRET` and logs an `error`. Change this to a `warn` stating: `"GITHUB_WEBHOOK_SECRET is not configured — webhook HMAC validation is disabled"`.
- [x] Task 3: Apply Guard to Webhook Endpoint (AC: 1)
  - [x] Verify the guard is applied to `POST /github` in `GitHubWebhooksController` (`src/webhooks/github-webhooks.controller.ts`). Ensure it works as expected when secret is available or empty.

## Dev Notes

### Technical Requirements & Anti-Patterns

- **Raw Body Requirement**: In NestJS, computing HMAC signatures requires the exact raw payload as received by the server. Standard JSON parsing destroys the original string formatting, which breaks the HMAC hash. You must ensure `rawBody: true` is configured in `main.ts` or use a custom raw body parser middleware specifically for the webhook route.
- **Timing Attacks**: Use `crypto.timingSafeEqual` when comparing the calculated signature with the incoming header signature to prevent timing attacks.
- **Fail-Open vs Fail-Closed**: As per AC2, if the secret is deliberately not provided (e.g., local development), log a warning but allow requests to pass, making it fail-open locally but secure when configured.
- **Code Organization**: The signature guard or interceptor should be placed in `src/webhooks/guards/` or a similarly appropriate shared security module.
- **Learnings from 25-1**: When writing tests, be mindful of any arbitrary `retryDelayMs` and configure it to `0` in test environments to keep CI fast.

### Project Structure Notes

- Alignment with unified project structure: The `GitHubWebhooksController` (`src/webhooks/github-webhooks.controller.ts`) handles the GitHub webhook and resides in `src/webhooks`. The signature guard already exists in `src/webhooks/guards/github-webhook-signature.guard.ts`.

### References

- QA Functional Requirement: QA-FR1 (BE-1 CRITICAL) [Source: docs/QA-REPORT-2026-02-27.md]
- QA Non-Functional Requirement: QA-NFR1 [Source: docs/QA-REPORT-2026-02-27.md]
- Epic 25: QA Stabilization [Source: _bmad-output/planning-artifacts/epics.md#Story 25.2]

## Dev Agent Record

### Agent Model Used

Antigravity BMad Create Story

### Debug Log References

- Fixed failing test regressions in `execution.repository.spec.ts` due to unmocked `updateMany`.

### Senior Developer Review (AI)

**Reviewer:** Khakanali — 2026-02-27 | **Outcome:** Approved with fixes applied

**Issues Found:** 1 High, 3 Medium, 2 Low — all fixed automatically.

| #   | Severity | Issue                                                                                                                                          | Fix Applied                                                                                                        |
| --- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| H1  | HIGH     | No controller-level test verifying `@UseGuards(GitHubWebhookSignatureGuard)` is applied — guard could be silently removed                      | Added `security — guard wiring` describe block in `github-webhooks.controller.spec.ts` using `Reflect.getMetadata` |
| M1  | MEDIUM   | `sprint-status.yaml` modified but absent from story File List                                                                                  | Added to File List                                                                                                 |
| M2  | MEDIUM   | Per-request `logger.warn(...)` in `canActivate` when secret is absent floods logs on every request (constructor warn at startup is sufficient) | Changed to `logger.debug(...)`                                                                                     |
| M3  | MEDIUM   | Missing edge-case tests for malformed `X-Hub-Signature-256` values (wrong algo, empty hex, no separator, non-hex chars)                        | Added 4 tests in `malformed signature header values` describe block                                                |
| L1  | LOW      | `(request as any).rawBody` was type-unsafe with eslint-disable                                                                                 | Introduced `FastifyRequestWithRawBody` interface; removed `any` cast                                               |
| L2  | LOW      | Per-request log message said "bypassing HMAC validation" rather than "unverified" per AC2 wording                                              | Updated message: `"Processing unverified webhook request — GITHUB_WEBHOOK_SECRET not configured"`                  |

**All ACs verified:** AC1 ✅ AC2 ✅ — **14 tests pass**, 0 linter errors.

### Completion Notes List

- Updated `GitHubWebhookSignatureGuard` in `src/webhooks/guards/github-webhook-signature.guard.ts` to log an appropriate warning and bypass HMAC verification if `GITHUB_WEBHOOK_SECRET` is unset.
- Kept the endpoint fully protected with `crypto.timingSafeEqual` if `GITHUB_WEBHOOK_SECRET` is defined.
- Created `src/webhooks/guards/github-webhook-signature.guard.spec.ts` for rigorous unit testing of both configured and unconfigured secret scenarios.
- Fixed an unrelated test failure in `execution.repository.spec.ts`. All 1,814 unit tests pass successfully.

### File List

- `src/webhooks/guards/github-webhook-signature.guard.ts` (Modified)
- `src/webhooks/guards/github-webhook-signature.guard.spec.ts` (New)
- `src/webhooks/github-webhooks.controller.spec.ts` (Modified)
- `src/execution/execution.repository.spec.ts` (Modified)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (Modified)
