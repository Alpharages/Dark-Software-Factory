/*
  Warnings:

  - A unique constraint covering the columns `[execution_id]` on the table `qa_results` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `updated_at` to the `qa_results` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "qa_results" ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL,
ALTER COLUMN "linting_passed" SET DEFAULT false,
ALTER COLUMN "tests_passed" SET DEFAULT false,
ALTER COLUMN "code_review_passed" SET DEFAULT false,
ALTER COLUMN "overall_passed" SET DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "qa_results_execution_id_key" ON "qa_results"("execution_id");

-- CreateIndex
CREATE INDEX "qa_results_overall_passed_created_at_idx" ON "qa_results"("overall_passed", "created_at");

-- AddForeignKey
ALTER TABLE "qa_results" ADD CONSTRAINT "qa_results_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
