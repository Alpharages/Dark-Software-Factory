-- CreateIndex
CREATE INDEX "ai_decision_logs_confidence_timestamp_idx" ON "ai_decision_logs"("confidence", "timestamp");
