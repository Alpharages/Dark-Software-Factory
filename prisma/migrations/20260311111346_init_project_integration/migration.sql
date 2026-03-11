-- CreateEnum
CREATE TYPE "IntegrationProvider" AS ENUM ('CLICKUP', 'JIRA', 'ASANA');

-- CreateTable
CREATE TABLE "project_integrations" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "workspace_name" TEXT NOT NULL,
    "access_token" TEXT,
    "refresh_token" TEXT,
    "token_expiry" TIMESTAMP(3),
    "bot_user_id" TEXT,
    "bot_username" TEXT,
    "polling_enabled" BOOLEAN NOT NULL DEFAULT false,
    "polling_interval_min" INTEGER NOT NULL DEFAULT 15,
    "polling_last_run_at" TIMESTAMP(3),
    "webhook_enabled" BOOLEAN NOT NULL DEFAULT false,
    "webhook_id" TEXT,
    "webhook_secret" TEXT,
    "provider_config" JSONB NOT NULL,
    "ai_trigger_status" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_integrations_project_id_idx" ON "project_integrations"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_integrations_project_id_provider_key" ON "project_integrations"("project_id", "provider");

-- AddForeignKey
ALTER TABLE "project_integrations" ADD CONSTRAINT "project_integrations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
