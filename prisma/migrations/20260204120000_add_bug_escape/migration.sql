-- CreateEnum
CREATE TYPE "EscapeCategory" AS ENUM ('LINTING_MISS', 'TEST_GAP', 'COVERAGE_BLINDSPOT', 'AI_GENERATION_ERROR', 'REVIEW_FAILURE', 'DEPENDENCY_ISSUE', 'ENVIRONMENT_DIFFERENCE', 'UNKNOWN');

-- CreateTable
CREATE TABLE "bug_escapes" (
    "id" TEXT NOT NULL,
    "production_error_id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "execution_id" TEXT,
    "qa_result_id" TEXT,
    "qa_review_queue_id" TEXT,
    "escape_category" "EscapeCategory" NOT NULL,
    "severity_at_detection" "ErrorSeverity" NOT NULL,
    "detected_at" TIMESTAMP(3) NOT NULL,
    "resolved_at" TIMESTAMP(3),
    "resolution_time_hours" DOUBLE PRECISION,
    "project_id" TEXT NOT NULL,
    "ai_provider" TEXT,
    "complexity_score" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bug_escapes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bug_escapes_production_error_id_key" ON "bug_escapes"("production_error_id");

-- CreateIndex
CREATE INDEX "bug_escapes_project_id_detected_at_idx" ON "bug_escapes"("project_id", "detected_at");

-- CreateIndex
CREATE INDEX "bug_escapes_detected_at_idx" ON "bug_escapes"("detected_at");

-- CreateIndex
CREATE INDEX "bug_escapes_escape_category_idx" ON "bug_escapes"("escape_category");

-- CreateIndex
CREATE INDEX "bug_escapes_ai_provider_detected_at_idx" ON "bug_escapes"("ai_provider", "detected_at");

-- AddForeignKey
ALTER TABLE "bug_escapes" ADD CONSTRAINT "bug_escapes_production_error_id_fkey" FOREIGN KEY ("production_error_id") REFERENCES "production_errors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bug_escapes" ADD CONSTRAINT "bug_escapes_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bug_escapes" ADD CONSTRAINT "bug_escapes_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "executions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bug_escapes" ADD CONSTRAINT "bug_escapes_qa_result_id_fkey" FOREIGN KEY ("qa_result_id") REFERENCES "qa_results"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bug_escapes" ADD CONSTRAINT "bug_escapes_qa_review_queue_id_fkey" FOREIGN KEY ("qa_review_queue_id") REFERENCES "qa_review_queue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

