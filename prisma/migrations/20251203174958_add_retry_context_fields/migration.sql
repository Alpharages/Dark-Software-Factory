/*
  Warnings:

  - The values [CURSOR,WINDSURF,ANTIGRAVITY] on the enum `AIProvider` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "AIProvider_new" AS ENUM ('CURSOR_HEADLESS', 'CLAUDE_CODE');
ALTER TABLE "executions" ALTER COLUMN "ai_provider" TYPE "AIProvider_new" USING ("ai_provider"::text::"AIProvider_new");

ALTER TABLE "cost_records" ALTER COLUMN "ai_provider" TYPE "AIProvider_new" USING ("ai_provider"::text::"AIProvider_new");
ALTER TYPE "AIProvider" RENAME TO "AIProvider_old";
ALTER TYPE "AIProvider_new" RENAME TO "AIProvider";
DROP TYPE "AIProvider_old";
COMMIT;

-- AlterTable
ALTER TABLE "executions" ADD COLUMN     "complexity_breakdown" JSONB,
ADD COLUMN     "complexity_score" INTEGER,
ADD COLUMN     "error_context" TEXT,
ADD COLUMN     "fallback_used" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "original_provider" "AIProvider",
ADD COLUMN     "routing_reason" TEXT,
ADD COLUMN     "scheduled_retry_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "executions_scheduled_retry_at_idx" ON "executions"("scheduled_retry_at");
