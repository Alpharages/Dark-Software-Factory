# AI Context

## OpenHarness Pivot

DSF is pivoting away from bespoke AI execution runtime code toward a thin control shell over
OpenHarness, BMAD skills, and Lore memory. The current single-tenant integration point is:

- `openharness/mcp-config.json` for BMAD and Lore HTTP MCP server definitions.
- `scripts/oh-mcp-smoke.sh` for local dry-run and read-only MCP reachability checks.
- `docs/openharness/mcp-setup.md` for setup and troubleshooting.

For OHP-1.1, do not touch NestJS `src/` execution, `ai-routing/`, RabbitMQ, or dispatcher code.
The story is configuration and runbook-only. OAuth/per-tenant credential injection is deferred
to OHP-4; this phase uses one ClickUp token, one ClickUp team, and one Lore project key.
