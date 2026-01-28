-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "deactivated_at" TIMESTAMP(3),
ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true;
