-- CreateEnum
CREATE TYPE "ContextFileFormat" AS ENUM ('PDF', 'MARKDOWN', 'TEXT', 'DOCX');

-- CreateEnum
CREATE TYPE "ExtractionStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "context_documents" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "original_filename" TEXT NOT NULL,
    "file_format" "ContextFileFormat" NOT NULL,
    "file_size_bytes" INTEGER NOT NULL,
    "file_hash" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "extracted_text" TEXT NOT NULL,
    "extraction_status" "ExtractionStatus" NOT NULL DEFAULT 'PENDING',
    "extraction_error" TEXT,
    "document_title" TEXT,
    "document_type" TEXT,
    "content_summary" TEXT,
    "content_hash" TEXT,
    "cached_at" TIMESTAMP(3),
    "cache_expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "context_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "context_documents_file_hash_key" ON "context_documents"("file_hash");

-- CreateIndex
CREATE INDEX "context_documents_ticket_id_idx" ON "context_documents"("ticket_id");

-- CreateIndex
CREATE INDEX "context_documents_file_hash_idx" ON "context_documents"("file_hash");

-- CreateIndex
CREATE INDEX "context_documents_extraction_status_idx" ON "context_documents"("extraction_status");

-- AddForeignKey
ALTER TABLE "context_documents" ADD CONSTRAINT "context_documents_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
