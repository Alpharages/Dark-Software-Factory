ALTER TABLE "executions" ADD COLUMN "selected_account_id" TEXT;

CREATE INDEX "executions_selected_account_id_idx" ON "executions"("selected_account_id");

ALTER TABLE "executions" ADD CONSTRAINT "executions_selected_account_id_fkey" FOREIGN KEY ("selected_account_id") REFERENCES "ai_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
