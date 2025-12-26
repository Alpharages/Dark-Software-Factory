-- CreateEnum
CREATE TYPE "ApprovalDecision" AS ENUM ('APPROVE', 'REJECT', 'REWORK', 'ESCALATE');

-- AlterEnum
ALTER TYPE "ExecutionStatus" ADD VALUE 'AWAITING_APPROVAL';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TicketStatus" ADD VALUE 'AWAITING_APPROVAL';
ALTER TYPE "TicketStatus" ADD VALUE 'APPROVED';
ALTER TYPE "TicketStatus" ADD VALUE 'REJECTED';
ALTER TYPE "TicketStatus" ADD VALUE 'AWAITING_REWORK';

-- CreateTable
CREATE TABLE "approval_records" (
    "id" TEXT NOT NULL,
    "execution_id" TEXT NOT NULL,
    "pm_id" TEXT NOT NULL,
    "decision" "ApprovalDecision" NOT NULL,
    "reasoning" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'PM',
    "managed_by_id" TEXT,
    "max_tickets" INTEGER NOT NULL DEFAULT 20,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "utilization_history" (
    "id" TEXT NOT NULL,
    "pm_id" TEXT NOT NULL,
    "snapshot_date" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active_tickets" INTEGER NOT NULL,
    "max_tickets" INTEGER NOT NULL,
    "utilization_pct" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "utilization_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "approval_records_execution_id_idx" ON "approval_records"("execution_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_managed_by_id_idx" ON "users"("managed_by_id");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE INDEX "utilization_history_pm_id_snapshot_date_idx" ON "utilization_history"("pm_id", "snapshot_date");

-- CreateIndex
CREATE INDEX "utilization_history_snapshot_date_idx" ON "utilization_history"("snapshot_date");

-- CreateIndex
CREATE UNIQUE INDEX "utilization_history_pm_id_snapshot_date_key" ON "utilization_history"("pm_id", "snapshot_date");

-- AddForeignKey
ALTER TABLE "approval_records" ADD CONSTRAINT "approval_records_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_managed_by_id_fkey" FOREIGN KEY ("managed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "utilization_history" ADD CONSTRAINT "utilization_history_pm_id_fkey" FOREIGN KEY ("pm_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
