-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "conversation_id" TEXT;

-- CreateTable
CREATE TABLE "client_conversations" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "pm_id" TEXT NOT NULL,
    "conversation_date" TIMESTAMP(3) NOT NULL,
    "title" TEXT NOT NULL,
    "transcript" TEXT NOT NULL,
    "summary" TEXT,
    "action_items" JSONB[],
    "sentiment" TEXT,
    "audio_file_url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'uploaded',
    "processing_cost" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "client_conversations_project_id_conversation_date_idx" ON "client_conversations"("project_id", "conversation_date");

-- CreateIndex
CREATE INDEX "client_conversations_sentiment_idx" ON "client_conversations"("sentiment");

-- CreateIndex
CREATE INDEX "client_conversations_status_idx" ON "client_conversations"("status");

-- Create full-text search index for PostgreSQL (using GIN index with to_tsvector)
CREATE INDEX "client_conversations_fulltext_idx" ON "client_conversations" USING GIN (
  to_tsvector('english', coalesce(transcript, '') || ' ' || coalesce(summary, '') || ' ' || coalesce(title, ''))
);


-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "client_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_conversations" ADD CONSTRAINT "client_conversations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_conversations" ADD CONSTRAINT "client_conversations_pm_id_fkey" FOREIGN KEY ("pm_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
