-- Story 12.2: Add ETA calculation fields to TicketDependency
ALTER TABLE "ticket_dependencies" ADD COLUMN "estimated_eta" TIMESTAMP(3);
ALTER TABLE "ticket_dependencies" ADD COLUMN "eta_calculated_at" TIMESTAMP(3);
