/*
  Warnings:

  - The values [CURSOR_HEADLESS] on the enum `AIProvider` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
-- Data Migration: Retire CURSOR_HEADLESS
UPDATE "executions" SET "ai_provider" = 'CLAUDE_CODE' WHERE "ai_provider" = 'CURSOR_HEADLESS';
UPDATE "executions" SET "original_provider" = 'CLAUDE_CODE' WHERE "original_provider" = 'CURSOR_HEADLESS';
UPDATE "cost_records" SET "ai_provider" = 'CLAUDE_CODE' WHERE "ai_provider" = 'CURSOR_HEADLESS';
UPDATE "ai_cost_logs" SET "ai_provider" = 'CLAUDE_CODE' WHERE "ai_provider" = 'CURSOR_HEADLESS';

CREATE TYPE "AIProvider_new" AS ENUM ('CLAUDE_CODE', 'GEMINI', 'CODEX', 'KIMI');
ALTER TABLE "executions" ALTER COLUMN "ai_provider" TYPE "AIProvider_new" USING ("ai_provider"::text::"AIProvider_new");
ALTER TABLE "executions" ALTER COLUMN "original_provider" TYPE "AIProvider_new" USING ("original_provider"::text::"AIProvider_new");
ALTER TABLE "cost_records" ALTER COLUMN "ai_provider" TYPE "AIProvider_new" USING ("ai_provider"::text::"AIProvider_new");
ALTER TABLE "ai_cost_logs" ALTER COLUMN "ai_provider" TYPE "AIProvider_new" USING ("ai_provider"::text::"AIProvider_new");
ALTER TYPE "AIProvider" RENAME TO "AIProvider_old";
ALTER TYPE "AIProvider_new" RENAME TO "AIProvider";
DROP TYPE "public"."AIProvider_old";
COMMIT;
