-- AlterTable
ALTER TABLE "production_errors" ADD COLUMN     "affected_users" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "deployment_id" TEXT,
ADD COLUMN     "occurrence_count" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "parsed_stack_trace" JSONB,
ADD COLUMN     "user_context" JSONB;

-- CreateTable
CREATE TABLE "production_error_commits" (
    "id" TEXT NOT NULL,
    "production_error_id" TEXT NOT NULL,
    "commit_sha" TEXT NOT NULL,
    "commit_message" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "committed_at" TIMESTAMP(3) NOT NULL,
    "file_path" TEXT NOT NULL,
    "relevance_score" DOUBLE PRECISION NOT NULL,
    "github_url" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_error_commits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "production_error_commits_production_error_id_idx" ON "production_error_commits"("production_error_id");

-- CreateIndex
CREATE INDEX "production_error_commits_commit_sha_idx" ON "production_error_commits"("commit_sha");

-- CreateIndex
CREATE INDEX "production_errors_deployment_id_idx" ON "production_errors"("deployment_id");

-- AddForeignKey
ALTER TABLE "production_errors" ADD CONSTRAINT "production_errors_deployment_id_fkey" FOREIGN KEY ("deployment_id") REFERENCES "deployments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_error_commits" ADD CONSTRAINT "production_error_commits_production_error_id_fkey" FOREIGN KEY ("production_error_id") REFERENCES "production_errors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
