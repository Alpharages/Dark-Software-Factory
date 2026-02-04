-- AlterTable
ALTER TABLE "production_errors" ADD COLUMN     "acknowledged_at" TIMESTAMP(3),
ADD COLUMN     "acknowledged_by" TEXT,
ADD COLUMN     "resolved_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "production_errors_acknowledged_at_idx" ON "production_errors"("acknowledged_at");

-- CreateIndex
CREATE INDEX "production_errors_resolved_at_idx" ON "production_errors"("resolved_at");
