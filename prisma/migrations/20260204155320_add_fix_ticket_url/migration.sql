-- AlterTable
ALTER TABLE "production_errors" ADD COLUMN     "fix_ticket_url" TEXT;

-- CreateTable
CREATE TABLE "quality_gate_configs" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "minTestPassRate" INTEGER NOT NULL DEFAULT 100,
    "minCoverage" INTEGER NOT NULL DEFAULT 80,
    "maxLintingErrors" INTEGER NOT NULL DEFAULT 0,
    "maxLintingWarnings" INTEGER NOT NULL DEFAULT 10,
    "blockOnCriticalSecurity" BOOLEAN NOT NULL DEFAULT true,
    "blockOnHighSecurity" BOOLEAN NOT NULL DEFAULT true,
    "maxComplexity" INTEGER NOT NULL DEFAULT 20,
    "targetCoverage" INTEGER NOT NULL DEFAULT 90,
    "enabledCategories" JSONB NOT NULL DEFAULT '["LINTING", "TESTING", "COVERAGE", "SECURITY"]',
    "allowOverride" BOOLEAN NOT NULL DEFAULT false,
    "overrideRequiresApproval" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,

    CONSTRAINT "quality_gate_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_gate_config_history" (
    "id" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "projectId" TEXT,
    "snapshot" JSONB NOT NULL,
    "version" INTEGER NOT NULL,
    "changedById" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changeReason" TEXT,

    CONSTRAINT "quality_gate_config_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_anomalies" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "current_value" DOUBLE PRECISION NOT NULL,
    "previous_value" DOUBLE PRECISION,
    "expected_min" DOUBLE PRECISION,
    "expected_max" DOUBLE PRECISION,
    "change_percent" DOUBLE PRECISION,
    "ai_analysis" JSONB,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolved_at" TIMESTAMP(3),
    "resolved_by" TEXT,
    "resolution_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quality_anomalies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_anomaly_configs" (
    "id" TEXT NOT NULL,
    "project_id" TEXT,
    "thresholds" JSONB NOT NULL,
    "notifications_enabled" BOOLEAN NOT NULL DEFAULT true,
    "slack_channels" TEXT[],
    "email_recipients" TEXT[],
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "quality_anomaly_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "quality_gate_configs_projectId_key" ON "quality_gate_configs"("projectId");

-- CreateIndex
CREATE INDEX "quality_gate_configs_projectId_idx" ON "quality_gate_configs"("projectId");

-- CreateIndex
CREATE INDEX "quality_gate_config_history_configId_idx" ON "quality_gate_config_history"("configId");

-- CreateIndex
CREATE INDEX "quality_gate_config_history_projectId_idx" ON "quality_gate_config_history"("projectId");

-- CreateIndex
CREATE INDEX "quality_gate_config_history_changedAt_idx" ON "quality_gate_config_history"("changedAt");

-- CreateIndex
CREATE INDEX "quality_anomalies_project_id_idx" ON "quality_anomalies"("project_id");

-- CreateIndex
CREATE INDEX "quality_anomalies_status_idx" ON "quality_anomalies"("status");

-- CreateIndex
CREATE INDEX "quality_anomalies_detected_at_idx" ON "quality_anomalies"("detected_at");

-- CreateIndex
CREATE INDEX "quality_anomalies_severity_idx" ON "quality_anomalies"("severity");

-- CreateIndex
CREATE UNIQUE INDEX "quality_anomaly_configs_project_id_key" ON "quality_anomaly_configs"("project_id");

-- AddForeignKey
ALTER TABLE "quality_gate_configs" ADD CONSTRAINT "quality_gate_configs_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_gate_configs" ADD CONSTRAINT "quality_gate_configs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_gate_configs" ADD CONSTRAINT "quality_gate_configs_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_gate_config_history" ADD CONSTRAINT "quality_gate_config_history_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_gate_config_history" ADD CONSTRAINT "quality_gate_config_history_configId_fkey" FOREIGN KEY ("configId") REFERENCES "quality_gate_configs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
