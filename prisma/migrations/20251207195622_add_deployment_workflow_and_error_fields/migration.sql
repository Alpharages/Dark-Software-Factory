-- AlterTable
ALTER TABLE "deployments" ADD COLUMN     "error_message" TEXT,
ADD COLUMN     "workflow_id" TEXT;

-- CreateIndex
CREATE INDEX "deployments_github_push_id_idx" ON "deployments"("github_push_id");

-- CreateIndex
CREATE INDEX "deployments_status_environment_idx" ON "deployments"("status", "environment");

-- AddForeignKey
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_github_push_id_fkey" FOREIGN KEY ("github_push_id") REFERENCES "github_pushes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
