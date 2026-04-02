-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "code_review_status" TEXT,
ADD COLUMN     "manual_review_status" TEXT,
ADD COLUMN     "qa_failure_status" TEXT;
