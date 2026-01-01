-- CreateEnum
CREATE TYPE "ProjectProvider" AS ENUM ('CLICKUP', 'JIRA', 'ASANA');

-- AlterTable
ALTER TABLE "adrs" ADD COLUMN     "escalation_duration_seconds" INTEGER;

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "monitor_tasks" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "provider" "ProjectProvider" NOT NULL DEFAULT 'CLICKUP',
ADD COLUMN     "sync_config" JSONB;
