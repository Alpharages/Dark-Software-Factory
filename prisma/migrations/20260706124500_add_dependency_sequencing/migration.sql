-- Dependency edge direction/source for provider-aware sync.
CREATE TYPE "DependencyEdgeType" AS ENUM ('waiting_on', 'blocking');
CREATE TYPE "DependencyBlockBehavior" AS ENUM ('hold', 'auto_resume');

ALTER TABLE "ticket_dependencies"
  ADD COLUMN "type" "DependencyEdgeType" NOT NULL DEFAULT 'waiting_on',
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'clickup';

DROP INDEX "ticket_dependencies_ticket_id_depends_on_key";
CREATE UNIQUE INDEX "ticket_dependencies_ticket_id_depends_on_source_key"
  ON "ticket_dependencies"("ticket_id", "depends_on", "source");

ALTER TABLE "projects"
  ADD COLUMN "dependency_block_behavior" "DependencyBlockBehavior" NOT NULL DEFAULT 'auto_resume';

ALTER TABLE "tickets"
  ADD COLUMN "dependency_block_behavior" "DependencyBlockBehavior";

ALTER TYPE "TicketStatus" ADD VALUE IF NOT EXISTS 'AWAITING_DEPENDENCY_RELEASE';
