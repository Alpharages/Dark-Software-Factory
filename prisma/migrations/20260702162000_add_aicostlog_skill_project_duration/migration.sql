ALTER TABLE "ai_cost_logs"
  ADD COLUMN "skill" TEXT,
  ADD COLUMN "project_id" TEXT,
  ADD COLUMN "selected_account_id" TEXT,
  ADD COLUMN "duration_ms" INTEGER;

CREATE INDEX "ai_cost_logs_skill_timestamp_idx" ON "ai_cost_logs"("skill", "timestamp");
CREATE INDEX "ai_cost_logs_project_id_skill_idx" ON "ai_cost_logs"("project_id", "skill");
