/*
  Warnings:

  - A unique constraint covering the columns `[project_id]` on the table `coverage_baselines` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TicketStatus" ADD VALUE 'BLOCKED_CIRCULAR';
ALTER TYPE "TicketStatus" ADD VALUE 'WAITING';
ALTER TYPE "TicketStatus" ADD VALUE 'WAITING_FOR_LOCKS';

-- AlterTable
ALTER TABLE "executions" ADD COLUMN     "selected_model" TEXT;

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "clickup_list_id" TEXT NOT NULL,
    "github_repository_url" TEXT NOT NULL,
    "default_branch" TEXT NOT NULL DEFAULT 'main',
    "budget_usd" DECIMAL(10,2) DEFAULT 100.00,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "projects_clickup_list_id_key" ON "projects"("clickup_list_id");

-- CreateIndex
CREATE UNIQUE INDEX "coverage_baselines_project_id_key" ON "coverage_baselines"("project_id");

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coverage_baselines" ADD CONSTRAINT "coverage_baselines_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_coverage_configs" ADD CONSTRAINT "project_coverage_configs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_cost_logs" ADD CONSTRAINT "ai_cost_logs_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
