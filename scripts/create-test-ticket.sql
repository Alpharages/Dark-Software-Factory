-- Create a test ticket directly in the database
-- This will be picked up by polling or can be manually routed to intake queue

INSERT INTO tickets (
  id,
  clickup_task_id,
  project_id,
  title,
  description,
  acceptance_criteria,
  ticket_quality_score,
  status,
  created_at,
  updated_at
) VALUES (
  gen_random_uuid(),
  'test-flow-' || EXTRACT(EPOCH FROM NOW())::text,
  'test-project',
  '🧪 Live Test - Workflow Validation ' || NOW(),
  E'This is a live test ticket to validate the complete processing workflow.\n\n## Description\nTest ticket created at ' || NOW() || E' to verify all 6 workflow stages execute correctly.\n\n## Acceptance Criteria\n- Ticket should be created ✓\n- Ticket should be validated\n- Ticket should be routed to AI processing\n- AI execution should begin\n- Execution should complete successfully',
  E'- Ticket should be created ✓\n- Ticket should be validated\n- Ticket should be routed to AI processing\n- AI execution should begin\n- Execution should complete successfully',
  0,
  'RECEIVED',
  NOW(),
  NOW()
)
RETURNING id, clickup_task_id, title, status;
