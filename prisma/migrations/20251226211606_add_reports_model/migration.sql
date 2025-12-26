-- CreateEnum
CREATE TYPE "ReportType" AS ENUM ('SPRINT', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- AlterTable
ALTER TABLE "client_conversations" ADD COLUMN     "clickup_task_ids" JSONB;

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "type" "ReportType" NOT NULL DEFAULT 'SPRINT',
    "status" "ReportStatus" NOT NULL DEFAULT 'PENDING',
    "title" TEXT NOT NULL,
    "date_start" TIMESTAMP(3) NOT NULL,
    "date_end" TIMESTAMP(3) NOT NULL,
    "raw_data" JSONB,
    "summary" TEXT,
    "narrative" TEXT,
    "insights" TEXT,
    "file_urls" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reports_project_id_date_start_date_end_idx" ON "reports"("project_id", "date_start", "date_end");

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
