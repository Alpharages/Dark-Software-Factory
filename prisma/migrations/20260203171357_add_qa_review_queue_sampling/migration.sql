-- CreateEnum
CREATE TYPE "QaReviewStatus" AS ENUM ('PENDING', 'IN_REVIEW', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SamplingStrategy" AS ENUM ('PERCENTAGE', 'RISK_BASED', 'RANDOM');

-- CreateTable
CREATE TABLE "qa_sampling_config" (
    "id" TEXT NOT NULL,
    "percentage" DECIMAL(5,2) NOT NULL DEFAULT 20.0,
    "risk_based_enabled" BOOLEAN NOT NULL DEFAULT true,
    "risk_rules" JSONB NOT NULL,
    "random_seed" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qa_sampling_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qa_review_queue" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "execution_id" TEXT NOT NULL,
    "project_id" TEXT,
    "pr_id" TEXT,
    "pr_url" TEXT,
    "status" "QaReviewStatus" NOT NULL DEFAULT 'PENDING',
    "risk_level" "RiskLevel" NOT NULL,
    "risk_factors" JSONB NOT NULL,
    "sampling_strategy" "SamplingStrategy" NOT NULL,
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "review_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qa_review_queue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "qa_review_queue_execution_id_key" ON "qa_review_queue"("execution_id");

-- CreateIndex
CREATE INDEX "qa_review_queue_status_created_at_idx" ON "qa_review_queue"("status", "created_at");

-- CreateIndex
CREATE INDEX "qa_review_queue_risk_level_created_at_idx" ON "qa_review_queue"("risk_level", "created_at");

-- CreateIndex
CREATE INDEX "qa_review_queue_project_id_status_idx" ON "qa_review_queue"("project_id", "status");

-- CreateIndex
CREATE INDEX "qa_review_queue_execution_id_idx" ON "qa_review_queue"("execution_id");

-- CreateIndex
CREATE INDEX "qa_review_queue_reviewed_by_reviewed_at_idx" ON "qa_review_queue"("reviewed_by", "reviewed_at");

-- AddForeignKey
ALTER TABLE "qa_review_queue" ADD CONSTRAINT "qa_review_queue_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "executions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
