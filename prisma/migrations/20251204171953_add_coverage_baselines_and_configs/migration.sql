-- CreateTable
CREATE TABLE "coverage_baselines" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "branch" TEXT NOT NULL DEFAULT 'main',
    "lines" DOUBLE PRECISION NOT NULL,
    "branches" DOUBLE PRECISION NOT NULL,
    "functions" DOUBLE PRECISION NOT NULL,
    "statements" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coverage_baselines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_coverage_configs" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL DEFAULT 80,
    "enforcement" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_coverage_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "coverage_baselines_project_id_idx" ON "coverage_baselines"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "coverage_baselines_project_id_branch_key" ON "coverage_baselines"("project_id", "branch");

-- CreateIndex
CREATE UNIQUE INDEX "project_coverage_configs_project_id_key" ON "project_coverage_configs"("project_id");
