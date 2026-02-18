-- CreateTable
CREATE TABLE "execution_activities" (
    "id" TEXT NOT NULL,
    "execution_id" TEXT NOT NULL,
    "ticket_id" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activity" TEXT NOT NULL,
    "detail" TEXT,
    "raw_content" TEXT,
    "category" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "suggested_percent" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "execution_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "execution_activities_execution_id_timestamp_idx" ON "execution_activities"("execution_id", "timestamp");

-- CreateIndex
CREATE INDEX "execution_activities_execution_id_category_idx" ON "execution_activities"("execution_id", "category");

-- AddForeignKey
ALTER TABLE "execution_activities" ADD CONSTRAINT "execution_activities_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
