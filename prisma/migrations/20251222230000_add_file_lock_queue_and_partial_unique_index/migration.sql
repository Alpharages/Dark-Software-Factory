-- CreateEnum
CREATE TYPE "FileLockQueueStatus" AS ENUM ('WAITING', 'ACQUIRED', 'CANCELLED');

-- CreateTable
CREATE TABLE "file_lock_queue" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "execution_id" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acquired_at" TIMESTAMP(3),
    "status" "FileLockQueueStatus" NOT NULL DEFAULT 'WAITING',

    CONSTRAINT "file_lock_queue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "file_lock_queue_file_path_status_requested_at_idx" ON "file_lock_queue"("file_path", "status", "requested_at");

-- CreateIndex
CREATE INDEX "file_lock_queue_ticket_id_idx" ON "file_lock_queue"("ticket_id");

-- CreateIndex
CREATE INDEX "file_lock_queue_execution_id_idx" ON "file_lock_queue"("execution_id");

-- CreateIndex
CREATE UNIQUE INDEX "file_lock_queue_ticket_id_execution_id_file_path_key" ON "file_lock_queue"("ticket_id", "execution_id", "file_path");

-- AddForeignKey
ALTER TABLE "file_lock_queue" ADD CONSTRAINT "file_lock_queue_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
-- AC#2: Enforce at most one ACTIVE lock per file path (status = LOCKED)
CREATE UNIQUE INDEX "file_locks_file_path_locked_key" ON "file_locks"("file_path") WHERE ("status" = 'LOCKED');


