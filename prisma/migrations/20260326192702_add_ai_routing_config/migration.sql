-- CreateTable
CREATE TABLE "ai_routing_configs" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "primaryProviderOverride" "AIProvider",
    "complexityThresholdMedium" INTEGER,
    "complexityThresholdHigh" INTEGER,
    "tierLowPrimary" "AIProvider",
    "tierLowFallback" "AIProvider",
    "tierMediumPrimary" "AIProvider",
    "tierMediumFallback" "AIProvider",
    "tierHighPrimary" "AIProvider",
    "tierHighFallback" "AIProvider",
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_routing_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_routing_configs_projectId_key" ON "ai_routing_configs"("projectId");

-- CreateIndex
CREATE INDEX "ai_routing_configs_projectId_idx" ON "ai_routing_configs"("projectId");

-- AddForeignKey
ALTER TABLE "ai_routing_configs" ADD CONSTRAINT "ai_routing_configs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_routing_configs" ADD CONSTRAINT "ai_routing_configs_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
