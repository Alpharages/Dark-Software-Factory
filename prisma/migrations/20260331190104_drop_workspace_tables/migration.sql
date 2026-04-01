/*
  Warnings:

  - You are about to drop the `workspace_archives` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `workspaces` table. If the table is not empty, all the data it contains will be lost.

*/
-- Safety gate: abort if any workspace rows exist (idempotent — skipped if tables already dropped)
DO $$
DECLARE
  workspace_count INTEGER := 0;
  archive_count INTEGER := 0;
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'workspaces') THEN
    SELECT COUNT(*) INTO workspace_count FROM workspaces;
  END IF;
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'workspace_archives') THEN
    SELECT COUNT(*) INTO archive_count FROM workspace_archives;
  END IF;
  IF workspace_count > 0 OR archive_count > 0 THEN
    RAISE EXCEPTION
      'drop_workspace_tables aborted: % workspace row(s) and % archive row(s) still exist. '
      'Drain all active executions before applying this migration.',
      workspace_count, archive_count;
  END IF;
END $$;

-- Drop archives first (FK dependency order)
DROP TABLE IF EXISTS workspace_archives CASCADE;
DROP TABLE IF EXISTS workspaces CASCADE;
DROP TYPE IF EXISTS "WorkspaceStatus";
DROP TYPE IF EXISTS "ArchiveStatus";
