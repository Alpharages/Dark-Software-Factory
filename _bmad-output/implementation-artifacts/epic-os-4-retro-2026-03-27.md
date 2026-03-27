# Epic OS-4 Retrospective: Multi-Provider AI Routing

## 🏁 Epic Summary

Epic OS-4 successfully transitioned DSF from a single-provider (Claude-only) system to a multi-provider ecosystem supporting Gemini, Codex, and Kimi. We implemented a sophisticated complexity-based routing engine with 3-level configuration overrides (Defaults -> Global -> Project), allowing granular control over AI cost and performance.

### Delivery Metrics

- **Stories Completed**: 6/6 (100%)
- **Providers Live**: Claude Code, Gemini 2.5 Pro, OpenAI Codex, Kimi K2.
- **Routing Integrity**: 100% test coverage on complexity thresholds and override logic.

---

## ✅ What Went Well (Wins)

- **Standardized Provider Interface**: The `ICodingAgentProvider` interface made adding Gemini, Codex, and Kimi trivial and consistent.
- **Secure Prompt Execution**: Adopting the "Env-Var Prompt" pattern (`command: 'gemini "$GEMINI_PROMPT"'`) across all providers eliminated shell injection risks while maintaining prompt integrity.
- **Dynamic Configuration**: The shift from hardcoded env-based routing to a DB-backed configuration provides immediate flexibility for PMs without requiring redeploys.
- **Frontend UX**: The new settings UI allows project-level overrides with a clean "Inherit from global" pattern, reducing configuration fatigue.

---

## ⚠️ Challenges & Learnings

- **Enum Sync Friction**: Maintaining parallel enums in NestJS (`ProviderName`) and Prisma (`AIProvider`) remains a manual, error-prone process that caused several type-safety "near misses."
- **Ghost Action Items**: Action items from the OS-3 retrospective (specifically **AI-1**: `filesChanged` reporting and **AI-2**: Configurable resource profiles) were unfortunately carried over into OS-4 as debt instead of being addressed.
- **Test Infrastructure Gaps**: Mocking the `ProviderFactory` in integration tests often misses new health check or execution signatures, leading to brittle test suites during provider onboarding.

---

## 🛠 Action Items for Epic OS-5

| ID       | Action Item                                                                                     | Owner   | Priority |
| :------- | :---------------------------------------------------------------------------------------------- | :------ | :------- |
| **AI-1** | Implement `filesChanged` logic in `ICodingAgentProvider` (parse diff/stdout) for all providers. | Amelia  | High     |
| **AI-2** | Migrate `SMALL`/`LARGE` profiles out of code and into `config.yaml`/`ConfigService`.            | Winston | Medium   |
| **AI-3** | Create a script or shared constant to unify NestJS and Prisma provider enums.                   | Winston | High     |
| **AI-4** | Perform the final `.env.example` regeneration and purge all `CURSOR_*` and `DOCKER_*` vars.     | Bob     | Critical |

---

## 🚀 Systemic Insights

- **The "Copy-Paste" Debt**: The `[]` return for `filesChanged` was copied from the initial `ClaudeCodeProvider` stub to all subsequent providers (Gemini, Codex, Kimi), demonstrating how debt propagates during rapid scaling of similar components.
- **Health Check Rigor**: We learned that a provider's `isHealthy()` must be a composite check (API Key present + Sandbox connectivity). This is now the standard for all new providers.
- **Complexity-Based Cost Control**: By routing low-complexity tasks to Kimi/Codex, we project a 30% reduction in API costs while reserving Claude/Gemini for high-impact architectural changes.
