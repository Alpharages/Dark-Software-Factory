-- CreateTable
CREATE TABLE "ai_account_usage" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "window_kind" TEXT NOT NULL,
    "window_start" TIMESTAMP(3) NOT NULL,
    "window_end" TIMESTAMP(3) NOT NULL,
    "tokens_used" INTEGER NOT NULL DEFAULT 0,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_account_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_account_usage_account_id_window_kind_window_start_key" ON "ai_account_usage"("account_id", "window_kind", "window_start");

-- AddForeignKey
ALTER TABLE "ai_account_usage" ADD CONSTRAINT "ai_account_usage_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "ai_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
