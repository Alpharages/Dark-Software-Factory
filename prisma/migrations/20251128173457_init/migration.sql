-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('RECEIVED', 'VALIDATED', 'VALIDATION_FAILED', 'QUEUED', 'AI_PROCESSING', 'QA_REVIEW', 'QA_FAILED', 'GITHUB_PUSH', 'DEPLOYING', 'DEPLOYED', 'MONITORING', 'FAILED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "AIProvider" AS ENUM ('CURSOR', 'WINDSURF', 'ANTIGRAVITY');

-- CreateEnum
CREATE TYPE "ExecutionStatus" AS ENUM ('QUEUED', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'TIMEOUT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "GitHubStatus" AS ENUM ('PENDING', 'BRANCH_CREATED', 'COMMITTED', 'PR_CREATED', 'MERGED', 'FAILED');

-- CreateEnum
CREATE TYPE "DeploymentStatus" AS ENUM ('TRIGGERED', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'ROLLED_BACK');

-- CreateEnum
CREATE TYPE "ErrorSeverity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');

-- CreateTable
CREATE TABLE "tickets" (
    "id" TEXT NOT NULL,
    "clickup_task_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "acceptance_criteria" TEXT NOT NULL,
    "ticket_quality_score" INTEGER NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'RECEIVED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "executions" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "ai_provider" "AIProvider" NOT NULL,
    "prompt" TEXT NOT NULL,
    "status" "ExecutionStatus" NOT NULL DEFAULT 'QUEUED',
    "confidence_score" DOUBLE PRECISION,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "error_message" TEXT,
    "code_output" TEXT,
    "files_changed" JSONB,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "max_retries" INTEGER NOT NULL DEFAULT 3,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qa_results" (
    "id" TEXT NOT NULL,
    "execution_id" TEXT NOT NULL,
    "linting_passed" BOOLEAN NOT NULL,
    "linting_errors" JSONB,
    "tests_passed" BOOLEAN NOT NULL,
    "test_results" JSONB,
    "test_coverage" DOUBLE PRECISION,
    "code_review_passed" BOOLEAN NOT NULL,
    "code_review_issues" JSONB,
    "overall_passed" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qa_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "github_pushes" (
    "id" TEXT NOT NULL,
    "execution_id" TEXT NOT NULL,
    "repository" TEXT NOT NULL,
    "branch_name" TEXT NOT NULL,
    "commit_sha" TEXT,
    "pr_number" INTEGER,
    "pr_url" TEXT,
    "push_status" "GitHubStatus" NOT NULL DEFAULT 'PENDING',
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "github_pushes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deployments" (
    "id" TEXT NOT NULL,
    "github_push_id" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "cicd_provider" TEXT NOT NULL,
    "build_id" TEXT,
    "status" "DeploymentStatus" NOT NULL DEFAULT 'TRIGGERED',
    "deployed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deployments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_records" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "ai_provider" "AIProvider" NOT NULL,
    "operation_type" TEXT NOT NULL,
    "tokens_used" INTEGER,
    "api_calls" INTEGER NOT NULL DEFAULT 1,
    "cost_in_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cost_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_errors" (
    "id" TEXT NOT NULL,
    "application" TEXT NOT NULL,
    "error_type" TEXT NOT NULL,
    "error_message" TEXT NOT NULL,
    "stack_trace" TEXT,
    "severity" "ErrorSeverity" NOT NULL,
    "fix_ticket_id" TEXT,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_errors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metrics" (
    "id" TEXT NOT NULL,
    "metric_name" TEXT NOT NULL,
    "metric_type" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "labels" JSONB,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actor_type" TEXT NOT NULL,
    "actor_id" TEXT,
    "before_state" JSONB,
    "after_state" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tickets_clickup_task_id_key" ON "tickets"("clickup_task_id");

-- CreateIndex
CREATE INDEX "tickets_project_id_status_idx" ON "tickets"("project_id", "status");

-- CreateIndex
CREATE INDEX "tickets_created_at_idx" ON "tickets"("created_at");

-- CreateIndex
CREATE INDEX "executions_ticket_id_status_idx" ON "executions"("ticket_id", "status");

-- CreateIndex
CREATE INDEX "executions_ai_provider_status_idx" ON "executions"("ai_provider", "status");

-- CreateIndex
CREATE INDEX "cost_records_ticket_id_idx" ON "cost_records"("ticket_id");

-- CreateIndex
CREATE INDEX "cost_records_ai_provider_created_at_idx" ON "cost_records"("ai_provider", "created_at");

-- CreateIndex
CREATE INDEX "production_errors_application_severity_resolved_idx" ON "production_errors"("application", "severity", "resolved");

-- CreateIndex
CREATE INDEX "metrics_metric_name_recorded_at_idx" ON "metrics"("metric_name", "recorded_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- AddForeignKey
ALTER TABLE "executions" ADD CONSTRAINT "executions_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_records" ADD CONSTRAINT "cost_records_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
