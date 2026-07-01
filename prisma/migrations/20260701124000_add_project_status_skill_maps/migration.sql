CREATE TABLE "project_status_skill_maps" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "normalized_status" TEXT NOT NULL,
    "skill" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_status_skill_maps_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "project_status_skill_maps_project_id_normalized_status_key" ON "project_status_skill_maps"("project_id", "normalized_status");

CREATE INDEX "project_status_skill_maps_project_id_idx" ON "project_status_skill_maps"("project_id");

ALTER TABLE "project_status_skill_maps" ADD CONSTRAINT "project_status_skill_maps_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
