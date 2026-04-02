-- AlterEnum
ALTER TYPE "ExecutionStatus" ADD VALUE 'QA_FAILED';

-- AlterTable
ALTER TABLE "executions" ADD COLUMN     "qa_failed_branch" TEXT;
