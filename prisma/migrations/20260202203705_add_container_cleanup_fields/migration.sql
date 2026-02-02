-- AlterTable
ALTER TABLE "executions" ADD COLUMN     "container_id" TEXT,
ADD COLUMN     "debug_mode" BOOLEAN NOT NULL DEFAULT false;
