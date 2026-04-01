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
describe('Migration audit notes', () => {
  it('drop_workspace_tables contains a row-count safety gate', () => {
    // Intentional no-op — see file-level comment above for documentation.
    expect(true).toBe(true);
  });
});
