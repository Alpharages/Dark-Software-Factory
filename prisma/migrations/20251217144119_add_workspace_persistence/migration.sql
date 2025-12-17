-- CreateEnum
CREATE TYPE "WorkspaceStatus" AS ENUM ('CREATING', 'READY', 'IN_USE', 'FAILED', 'CLEANING', 'CLEANED');

-- CreateTable
CREATE TABLE "workspaces" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "execution_id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "workspace_path" TEXT NOT NULL,
    "repository_url" TEXT,
    "branch_name" TEXT NOT NULL,
    "status" "WorkspaceStatus" NOT NULL DEFAULT 'CREATING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "cleaned_at" TIMESTAMP(3),

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_workspace_id_key" ON "workspaces"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_execution_id_key" ON "workspaces"("execution_id");

-- CreateIndex
CREATE INDEX "workspaces_execution_id_idx" ON "workspaces"("execution_id");

-- CreateIndex
CREATE INDEX "workspaces_ticket_id_idx" ON "workspaces"("ticket_id");

-- CreateIndex
CREATE INDEX "workspaces_status_created_at_idx" ON "workspaces"("status", "created_at");
