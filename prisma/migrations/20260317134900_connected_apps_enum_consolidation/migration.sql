-- Rename IntegrationProvider to PMProvider
ALTER TYPE "IntegrationProvider" RENAME TO "PMProvider";

-- Update projects table to use PMProvider instead of ProjectProvider
ALTER TABLE "projects" 
  ALTER COLUMN "provider" DROP DEFAULT,
  ALTER COLUMN "provider" TYPE "PMProvider" USING "provider"::text::"PMProvider",
  ALTER COLUMN "provider" SET DEFAULT 'CLICKUP';

-- Drop the now-unused ProjectProvider
DROP TYPE "ProjectProvider";

-- Create AppProvider enum for user-level OAuth connections
CREATE TYPE "AppProvider" AS ENUM ('CLICKUP', 'JIRA', 'ASANA', 'GITHUB', 'GITLAB', 'BITBUCKET', 'GMAIL', 'GOOGLE_CALENDAR', 'SLACK');

-- Create ConnectedApp table
CREATE TABLE "connected_apps" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" "AppProvider" NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "workspace_name" TEXT NOT NULL,
    "access_token" TEXT,
    "refresh_token" TEXT,
    "token_expiry" TIMESTAMP(3),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connected_apps_pkey" PRIMARY KEY ("id")
);

-- Indexes for performance and uniqueness
CREATE INDEX "connected_apps_user_id_provider_idx" ON "connected_apps"("user_id", "provider");
CREATE UNIQUE INDEX "connected_apps_user_id_provider_workspace_id_key" ON "connected_apps"("user_id", "provider", "workspace_id");

-- Foreign key constraint
ALTER TABLE "connected_apps" ADD CONSTRAINT "connected_apps_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
