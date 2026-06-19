# OHP-1.2 Run Report

- **Task:** [86ey07n48](https://app.clickup.com/t/86ey07n48)
- **Workflow:** `clickup-dev-implement`
- **Model:** `gpt-5.4`
- **Run type:** Headless OpenHarness CLI spike
- **Evidence log:** `docs/openharness/runs/ohp-1.2-86ey07n48.stream.json`
- **Wrapper:** `scripts/oh-run-skill.sh`

## Commands

```bash
set -a; source .env; set +a
scripts/oh-run-skill.sh 86ey07n48
```

The wrapper composes the required prompt, registers `bmad` and `lore` MCP servers for the run,
captures `--output-format stream-json`, blocks the `config` tool, restores OpenHarness settings,
and refuses to persist a log if any credential literal appears in the stream.

## Outcome

### AC1 — Skill completes & code is produced

- **Result:** Achieved for the docs/scripts spike scope.
- **Evidence:** The final captured stream shows `mcp__bmad__bmad` `execute` for
  `clickup-dev-implement`, then workflow read, task fetch, repo edits, Lore calls, M2 comment, and
  status transition. The code artifact is the thin wrapper `scripts/oh-run-skill.sh`; the rest of
  the diff is documentation/evidence.
- **Files changed:** `scripts/oh-run-skill.sh`, `docs/openharness/mcp-setup.md`,
  `docs/openharness/runs/ohp-1.2-86ey07n48.stream.json`,
  `docs/openharness/runs/ohp-1.2-report.md`, `docs/CHANGELOG.md`, and `docs/AI-CONTEXT.md`.

### AC2 — ClickUp status moves to review status

- **Result:** Achieved using this list's valid review status, `ready for review`.
- **Evidence:** The stream contains `mcp__bmad__addComment` for the M2 completion comment and
  `mcp__bmad__updateTask` setting status to `ready for review`. The story text says `in review`,
  but this ClickUp list does not have that exact status.

### AC3 — Lessons saved to Lore

- **Result:** Achieved.
- **Evidence:** The stream shows `mcp__lore__query_lessons_for_task`, then
  `mcp__lore__save_lesson` creating lesson `0a244401-a118-4814-b43c-83632f4a781e`.

### AC4 — Fidelity assessment on `gpt-5.4`

- **Verdict:** `gpt-5.4` can drive the BMAD execute path when MCP servers are registered through
  the `oh mcp add` fallback and the prompt explicitly names `mcp__bmad__bmad` as the first action.
- **Observed behavior:** Direct `--mcp-config` attempts were not reliable on OpenHarness `0.1.9`:
  one failed on the default Claude model alias, and a model-pinned attempt did not expose MCP
  servers to the agent. The wrapper-run fixed both issues by pinning `gpt-5.4`, registering MCP
  servers in the default config directory for the duration of the run, and denying config
  inspection.
- **Decision:** A Claude subscription profile is not required for OHP-1.2 based on this run.
  The practical requirement is to use the wrapper/fallback path until OpenHarness' direct
  `--mcp-config` behavior is fixed or upgraded.

### AC5 — `bmad` execute-tool drive confirmed

- **Result:** Achieved.
- **Evidence:** `docs/openharness/runs/ohp-1.2-86ey07n48.stream.json` contains
  `tool_started` for `mcp__bmad__bmad` with `operation: "execute"`,
  `workflow: "clickup-dev-implement"`, and `message: "86ey07n48"`.

### AC6 — Evidence captured

- **Result:** Achieved.
- **Artifacts:**
  - `docs/openharness/runs/ohp-1.2-86ey07n48.stream.json`
  - `docs/openharness/runs/ohp-1.2-report.md`
  - `scripts/oh-run-skill.sh`

## Notes

- This story's repo scope stayed in docs/scripts only; no `src/` files were touched.
- The run preserved the guardrail to format only changed files.
- The retained stream log is sanitized by the wrapper's credential scan before it is written to
  the repo.

## Independent Verification

- `bash -n scripts/oh-run-skill.sh` passed.
- Credential scan against the retained docs/script artifacts found no literal `BMAD_API_KEY`,
  `CLICKUP_API_KEY`, or `LORE_API_KEY` values.
- `pnpm run build` passed.
- `pnpm test` failed in pre-existing `src/` suites unrelated to this docs/scripts spike:
  `sandbox/sandbox.service.spec.ts`, `sandbox/sandbox-resource-profile.service.spec.ts`,
  `ai-routing/providers/kimi.provider.spec.ts`, `realtime/realtime.gateway.spec.ts`, and
  `execution/ai-execution.consumer.spec.ts` were among the reported failing areas. Final Jest
  summary: 6 failed suites, 192 passed suites; 59 failed tests, 2121 passed tests.
