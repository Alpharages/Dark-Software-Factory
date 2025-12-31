-- CreateEnum
CREATE TYPE "AdrStatus" AS ENUM ('PROPOSED', 'ACCEPTED', 'REJECTED', 'DEPRECATED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateTable
CREATE TABLE "adrs" (
    "id" TEXT NOT NULL,
    "execution_id" TEXT,
    "ticket_id" TEXT,
    "title" TEXT NOT NULL,
    "status" "AdrStatus" NOT NULL DEFAULT 'PROPOSED',
    "context" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "consequences" TEXT NOT NULL,
    "alternatives" TEXT,
    "ai_confidence" DOUBLE PRECISION,
    "risk_level" "RiskLevel",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "adrs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "adrs_execution_id_idx" ON "adrs"("execution_id");

-- CreateIndex
CREATE INDEX "adrs_ticket_id_idx" ON "adrs"("ticket_id");

-- CreateIndex
CREATE INDEX "adrs_status_idx" ON "adrs"("status");

-- AddForeignKey
ALTER TABLE "adrs" ADD CONSTRAINT "adrs_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "executions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adrs" ADD CONSTRAINT "adrs_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
