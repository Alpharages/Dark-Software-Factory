/*
  Warnings:

  - You are about to drop the column `ticket_id` on the `execution_activities` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "execution_activities" DROP COLUMN "ticket_id";

-- AlterTable
ALTER TABLE "executions" ADD COLUMN     "progress" JSONB;

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "github_account_id" TEXT;

-- CreateTable
CREATE TABLE "github_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "installation_id" TEXT NOT NULL,
    "access_token" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "avatar_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "github_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "github_accounts_installation_id_key" ON "github_accounts"("installation_id");

-- CreateIndex
CREATE INDEX "projects_github_account_id_idx" ON "projects"("github_account_id");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_github_account_id_fkey" FOREIGN KEY ("github_account_id") REFERENCES "github_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "github_accounts" ADD CONSTRAINT "github_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
