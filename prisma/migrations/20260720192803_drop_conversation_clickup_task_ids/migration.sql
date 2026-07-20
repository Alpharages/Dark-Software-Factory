/*
  Drops `client_conversations.clickup_task_ids` (Story 5.5.1).

  The column stored ClickUp task metadata linked back to a conversation by the
  AetherFlow integration. That integration was removed, so nothing writes or
  reads this column any more.

  SAFETY GATE: aborts if any row still holds a non-NULL value, so an
  environment that accumulated links is not silently stripped. Clear or export
  those rows first, then re-run.

  Idempotent: if the column is already gone (e.g. CI replay), the information_schema
  check skips the COUNT and the migration completes cleanly.
*/

DO $$
DECLARE
  linked_count BIGINT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'client_conversations'
      AND column_name = 'clickup_task_ids'
  ) THEN
    SELECT COUNT(*) INTO linked_count
    FROM "client_conversations"
    WHERE "clickup_task_ids" IS NOT NULL;

    IF linked_count > 0 THEN
      RAISE EXCEPTION
        'Refusing to drop client_conversations.clickup_task_ids: % row(s) still hold linked ClickUp task data. Export or clear them, then re-run.',
        linked_count;
    END IF;
  END IF;
END $$;

-- AlterTable
ALTER TABLE "client_conversations" DROP COLUMN IF EXISTS "clickup_task_ids";
