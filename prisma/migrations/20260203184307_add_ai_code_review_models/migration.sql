-- CreateTable
CREATE TABLE "production_approvals" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "approver_id" TEXT NOT NULL,
    "decision" "ApprovalDecision" NOT NULL,
    "override_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_code_reviews" (
    "id" TEXT NOT NULL,
    "queue_item_id" TEXT NOT NULL,
    "review_version" INTEGER NOT NULL DEFAULT 1,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ai_model" TEXT NOT NULL,
    "confidence_score" DECIMAL(3,2) NOT NULL,
    "overall_assessment" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "findings" JSONB NOT NULL,
    "generation_duration_ms" INTEGER NOT NULL,
    "token_usage" JSONB,
    "cost_usd" DECIMAL(10,6),
    "cache_key" TEXT,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_code_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_code_review_findings" (
    "id" TEXT NOT NULL,
    "ai_review_id" TEXT NOT NULL,
    "finding_key" TEXT NOT NULL,
    "finding_type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "file_path" TEXT,
    "line_number" INTEGER,
    "description" TEXT NOT NULL,
    "suggestion" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "review_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_code_review_findings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "production_approvals_ticket_id_idx" ON "production_approvals"("ticket_id");

-- CreateIndex
CREATE INDEX "production_approvals_approver_id_idx" ON "production_approvals"("approver_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_code_reviews_cache_key_key" ON "ai_code_reviews"("cache_key");

-- CreateIndex
CREATE INDEX "ai_code_reviews_queue_item_id_idx" ON "ai_code_reviews"("queue_item_id");

-- CreateIndex
CREATE INDEX "ai_code_reviews_generated_at_idx" ON "ai_code_reviews"("generated_at");

-- CreateIndex
CREATE INDEX "ai_code_reviews_cache_key_idx" ON "ai_code_reviews"("cache_key");

-- CreateIndex
CREATE UNIQUE INDEX "ai_code_reviews_queue_item_id_review_version_key" ON "ai_code_reviews"("queue_item_id", "review_version");

-- CreateIndex
CREATE INDEX "ai_code_review_findings_ai_review_id_idx" ON "ai_code_review_findings"("ai_review_id");

-- CreateIndex
CREATE INDEX "ai_code_review_findings_status_idx" ON "ai_code_review_findings"("status");

-- CreateIndex
CREATE INDEX "ai_code_review_findings_finding_key_idx" ON "ai_code_review_findings"("finding_key");

-- AddForeignKey
ALTER TABLE "production_approvals" ADD CONSTRAINT "production_approvals_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_code_reviews" ADD CONSTRAINT "ai_code_reviews_queue_item_id_fkey" FOREIGN KEY ("queue_item_id") REFERENCES "qa_review_queue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_code_review_findings" ADD CONSTRAINT "ai_code_review_findings_ai_review_id_fkey" FOREIGN KEY ("ai_review_id") REFERENCES "ai_code_reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;
