-- CreateTable
CREATE TABLE "ai_accounts" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "runtime" TEXT NOT NULL,
    "credentials" TEXT NOT NULL,
    "quota_config" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_accounts_provider_enabled_idx" ON "ai_accounts"("provider", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "ai_accounts_provider_label_key" ON "ai_accounts"("provider", "label");
