-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AdrStatus" ADD VALUE 'ESCALATED';
ALTER TYPE "AdrStatus" ADD VALUE 'GUIDANCE_PROVIDED';
ALTER TYPE "AdrStatus" ADD VALUE 'RESOLVED';

-- AlterTable
ALTER TABLE "adrs" ADD COLUMN     "delegate_to" TEXT,
ADD COLUMN     "escalation_duration_seconds" INTEGER,
ADD COLUMN     "escalation_questions" JSONB,
ADD COLUMN     "escalation_reason" TEXT,
ADD COLUMN     "guidance_provided_at" TIMESTAMP(3),
ADD COLUMN     "resolved_at" TIMESTAMP(3),
ADD COLUMN     "tl_guidance" TEXT,
ADD COLUMN     "trade_offs" JSONB;

-- CreateTable
CREATE TABLE "architecture_constraints" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "scope" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "rules" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "architecture_constraints_pkey" PRIMARY KEY ("id")
);
