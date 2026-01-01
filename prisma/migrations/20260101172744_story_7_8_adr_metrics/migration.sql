/*
  Warnings:

  - You are about to drop the column `escalation_duration_seconds` on the `adrs` table. All the data in the column will be lost.
  - You are about to drop the column `resolved_at` on the `adrs` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "adrs" DROP COLUMN "escalation_duration_seconds",
DROP COLUMN "resolved_at",
ADD COLUMN     "rejection_reason" TEXT,
ADD COLUMN     "resolving_execution_id" TEXT,
ADD COLUMN     "review_duration_seconds" INTEGER,
ADD COLUMN     "reviewed_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "adr_alerts" (
    "id" TEXT NOT NULL,
    "alert_type" TEXT NOT NULL,
    "triggered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "adr_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "adr_alerts_alert_type_triggered_at_idx" ON "adr_alerts"("alert_type", "triggered_at");
