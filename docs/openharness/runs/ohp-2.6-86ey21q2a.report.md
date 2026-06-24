# OHP-2.6 Validation Report — 86ey21q2a

Status: blocked, not passed.

Validation ticket: https://app.clickup.com/t/86ey21q2a
Parent task: https://app.clickup.com/t/86ey154gz

## What Ran

- Docker Postgres/RabbitMQ were started on local ports `5433` and `5672`.
- The backend was run locally against the Docker services.
- A real independent ClickUp validation ticket was created and ingested:
  `86ey21q2a` / `OHP-2.6 validation smoke — docs marker`.
- The poll/intake/dispatch path was exercised through RabbitMQ.
- A direct wrapper smoke stream was captured at:
  `docs/openharness/runs/ohp-2.6-86ey21q2a-wrapper-smoke.stream.json`.

## Evidence

- ClickUp polling initially reached the validation task but ClickUp's team task list omitted the
  task description, so intake rejected it for missing acceptance criteria.
- After fixing description hydration and plain-text acceptance-criteria parsing, the validation
  task ingested successfully as internal ticket `27388a6f-f52c-4266-8403-3b411fa371cc`.
- OpenHarness runner executions for the ticket reached the wrapper path, but the final two service
  runs failed with:
  `Network error: Connection error.. Check your internet connection and try again.`
- Final replay execution: `069f6593-9280-4efd-9624-49a4512790fc`, status `FAILED`.
- The validation ticket reached the configured dispatcher loop cap after five implement executions,
  so the requested full loop cannot honestly be marked passed in this run.

## Fixes Made

- `GitHubModule` imports `WebhooksModule` via `forwardRef` to restore Nest startup.
- The OpenHarness runner now invokes `scripts/oh-run-skill.sh` when available, passes the external
  ClickUp task id to BMAD, streams wrapper output back to the parser, and preserves inherited
  OpenHarness auth/config for wrapper runs.
- The stream parser treats OpenHarness `error` events as failed results and ignores empty
  `assistant_complete` keepalive events.
- ClickUp polling hydrates the full task when the team task list omits descriptions.
- Ticket intake accepts ClickUp's plain-text `Acceptance Criteria` label format.

## Verification

- `pnpm run typecheck`
- `pnpm test src/openharness/openharness-runner.service.spec.ts src/openharness/openharness-stream.parser.spec.ts src/integrations/providers/clickup/clickup.provider.spec.ts src/ticket-intake/ticket-intake.service.spec.ts`

## Current Blocker

The app path is no longer blocked on Docker, Nest startup, ClickUp description hydration, or stream
parsing. It is blocked on the OpenHarness child process returning a recoverable network error during
service-driven execution, and the validation ticket has now exhausted the dispatcher loop cap.
