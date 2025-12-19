-- CreateEnum
CREATE TYPE "FileLockStatus" AS ENUM ('LOCKED', 'RELEASED');

-- CreateEnum
CREATE TYPE "DependencyStatus" AS ENUM ('WAITING', 'BLOCKED', 'RESOLVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ArchiveStatus" AS ENUM ('PENDING', 'ARCHIVING', 'ARCHIVED', 'FAILED');

-- CreateEnum
CREATE TYPE "PRRiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- AlterTable
ALTER TABLE "executions" ADD COLUMN     "base_branch" TEXT,
ADD COLUMN     "branch_selection_log" TEXT,
ADD COLUMN     "circular_dep_detected" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "file_modifications" JSONB,
ADD COLUMN     "risk_level" "PRRiskLevel";

-- CreateTable
CREATE TABLE "ai_decision_logs" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "agent_name" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reasoning" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "execution_id" TEXT,
    "input_data" JSONB NOT NULL,
    "output_data" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "ai_decision_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_locks" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "execution_id" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "locked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at" TIMESTAMP(3),
    "status" "FileLockStatus" NOT NULL DEFAULT 'LOCKED',

    CONSTRAINT "file_locks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_cost_logs" (
    "id" TEXT NOT NULL,
    "execution_id" TEXT,
    "ticket_id" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ai_provider" "AIProvider" NOT NULL,
    "model_name" TEXT NOT NULL,
    "operation_type" TEXT NOT NULL,
    "tokens_input" INTEGER,
    "tokens_output" INTEGER,
    "tokens_total" INTEGER,
    "cost_usd" DECIMAL(10,6) NOT NULL,

    CONSTRAINT "ai_cost_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_dependencies" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "depends_on" TEXT NOT NULL,
    "status" "DependencyStatus" NOT NULL DEFAULT 'WAITING',
    "circular_detected" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "ticket_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_archives" (
    "id" TEXT NOT NULL,
    "execution_id" TEXT NOT NULL,
    "workspace_path" TEXT NOT NULL,
    "archive_path" TEXT,
    "size_bytes" BIGINT NOT NULL,
    "compressed_size" BIGINT,
    "status" "ArchiveStatus" NOT NULL DEFAULT 'PENDING',
    "archived_at" TIMESTAMP(3),
    "error_message" TEXT,

    CONSTRAINT "workspace_archives_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_decision_logs_ticket_id_timestamp_idx" ON "ai_decision_logs"("ticket_id", "timestamp");

-- CreateIndex
CREATE INDEX "ai_decision_logs_execution_id_idx" ON "ai_decision_logs"("execution_id");

-- CreateIndex
CREATE INDEX "ai_decision_logs_agent_name_idx" ON "ai_decision_logs"("agent_name");

-- CreateIndex
CREATE INDEX "ai_decision_logs_timestamp_idx" ON "ai_decision_logs"("timestamp");

-- CreateIndex
CREATE INDEX "file_locks_execution_id_idx" ON "file_locks"("execution_id");

-- CreateIndex
CREATE INDEX "file_locks_status_idx" ON "file_locks"("status");

-- CreateIndex
CREATE INDEX "file_locks_ticket_id_idx" ON "file_locks"("ticket_id");

-- CreateIndex
CREATE UNIQUE INDEX "file_locks_ticket_id_file_path_key" ON "file_locks"("ticket_id", "file_path");

-- CreateIndex
CREATE INDEX "ai_cost_logs_execution_id_idx" ON "ai_cost_logs"("execution_id");

-- CreateIndex
CREATE INDEX "ai_cost_logs_ticket_id_timestamp_idx" ON "ai_cost_logs"("ticket_id", "timestamp");

-- CreateIndex
CREATE INDEX "ai_cost_logs_ai_provider_timestamp_idx" ON "ai_cost_logs"("ai_provider", "timestamp");

-- CreateIndex
CREATE INDEX "ticket_dependencies_ticket_id_idx" ON "ticket_dependencies"("ticket_id");

-- CreateIndex
CREATE INDEX "ticket_dependencies_depends_on_idx" ON "ticket_dependencies"("depends_on");

-- CreateIndex
CREATE INDEX "ticket_dependencies_status_idx" ON "ticket_dependencies"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_dependencies_ticket_id_depends_on_key" ON "ticket_dependencies"("ticket_id", "depends_on");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_archives_execution_id_key" ON "workspace_archives"("execution_id");

-- CreateIndex
CREATE INDEX "workspace_archives_status_idx" ON "workspace_archives"("status");

-- CreateIndex
CREATE INDEX "workspace_archives_archived_at_idx" ON "workspace_archives"("archived_at");

-- AddForeignKey
ALTER TABLE "ai_decision_logs" ADD CONSTRAINT "ai_decision_logs_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "executions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_locks" ADD CONSTRAINT "file_locks_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_cost_logs" ADD CONSTRAINT "ai_cost_logs_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "executions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_archives" ADD CONSTRAINT "workspace_archives_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
