-- CreateEnum
CREATE TYPE "TaskType" AS ENUM ('CODE_GENERATION', 'TEST_GENERATION', 'REFACTORING', 'DOCUMENTATION', 'ARCHITECTURE_REVIEW', 'BUG_FIX');

-- AlterTable
ALTER TABLE "executions" ADD COLUMN     "task_type" "TaskType";

-- CreateTable
CREATE TABLE "ai_capabilities" (
    "id" TEXT NOT NULL,
    "task_type" "TaskType" NOT NULL,
    "success_count" INTEGER NOT NULL DEFAULT 0,
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "known_issues" TEXT,
    "workaround" TEXT,
    "is_disabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_capabilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_task_patterns" (
    "id" TEXT NOT NULL,
    "pattern_signature" TEXT NOT NULL,
    "task_type" "TaskType" NOT NULL,
    "failure_rate" DOUBLE PRECISION NOT NULL,
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "example_ids" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_task_patterns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_capabilities_task_type_key" ON "ai_capabilities"("task_type");

-- CreateIndex
CREATE INDEX "ai_task_patterns_task_type_failure_rate_idx" ON "ai_task_patterns"("task_type", "failure_rate");
