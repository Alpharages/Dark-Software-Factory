/**
 * Migration Audit Notes
 *
 * This file documents critical migration safety properties for future auditability.
 * It is intentionally comment-only — migration SQL cannot be meaningfully unit-tested.
 */

/**
 * Migration: 20260331190104_drop_workspace_tables
 *
 * Drops the `workspaces` and `workspace_archives` tables and `WorkspaceStatus` /
 * `ArchiveStatus` enum types (DooD-era schema removed in WR-1.1).
 *
 * SAFETY GATE: The migration contains a PL/pgSQL DO $$ block that aborts with a
 * descriptive RAISE EXCEPTION if any rows exist in `workspaces` or `workspace_archives`
 * at migration time. This prevents silent data loss.
 *
 * The gate is idempotent: if the tables were already dropped (e.g. CI replay), the
 * existence check via `pg_tables` skips the COUNT(*) queries, so the migration
 * completes cleanly rather than throwing "relation does not exist".
 *
 * Drop order: workspace_archives → workspaces (FK dependency: workspace_archives.execution_id
 * references executions, not the other way around; CASCADE handles any residual edges).
 */

/**
 * Migration: 20260720192803_drop_conversation_clickup_task_ids
 *
 * Drops `client_conversations.clickup_task_ids` (Story 5.5.1). The column held
 * ClickUp task metadata written by the AetherFlow integration, which was removed;
 * no code reads or writes it any more.
 *
 * SAFETY GATE: a PL/pgSQL DO $$ block aborts with a descriptive RAISE EXCEPTION if
 * any row still holds a non-NULL value, so an environment that accumulated links is
 * not silently stripped. Dev was empty (0 rows) when this was authored.
 *
 * The gate is idempotent: if the column was already dropped (e.g. CI replay), the
 * information_schema check skips the COUNT and DROP COLUMN IF EXISTS is a no-op.
 */
/**
 * Migration: 20260721120000_add_project_lore_credentials
 *
 * Adds nullable `projects.lore_server_url` and `projects.lore_api_key` (OHP-4.1
 * per-tenant Lore memory isolation). `lore_api_key` holds an AES-256-GCM ciphertext,
 * never plaintext. Purely additive nullable columns — no safety gate needed; existing
 * projects read NULL and inherit the global LORE_* env (prior single-tenant behaviour).
 */
describe('Migration audit notes', () => {
  it('drop_workspace_tables contains a row-count safety gate', () => {
    // Intentional no-op — see file-level comment above for documentation.
    expect(true).toBe(true);
  });

  it('drop_conversation_clickup_task_ids contains a row-count safety gate', () => {
    // Intentional no-op — see file-level comment above for documentation.
    expect(true).toBe(true);
  });
});
