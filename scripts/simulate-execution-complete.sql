-- Simulate successful AI execution completion
-- This will trigger the downstream QA automation flow

-- Step 1: Update execution to IN_PROGRESS then COMPLETED
UPDATE executions 
SET 
  status = 'IN_PROGRESS',
  started_at = NOW()
WHERE id = '5ccc99bb-2f5a-4104-9295-d5016992c6de';

-- Wait a moment, then complete
UPDATE executions
SET
  status = 'COMPLETED',
  completed_at = NOW(),
  confidence_score = 0.85,
  code_output = '// Mock code output from AI execution\n// Successfully implemented the feature\nfunction testFeature() {\n  return "success";\n}',
  files_changed = '["src/test.ts", "src/test.spec.ts"]'::jsonb
WHERE id = '5ccc99bb-2f5a-4104-9295-d5016992c6de';

-- Step 2: Update ticket status to QA_REVIEW
UPDATE tickets
SET status = 'QA_REVIEW'
WHERE id = 'c6ca86a0-c5ba-43c8-86ce-8aa0be6cbba1';

-- Verify the updates
SELECT 
  e.id as execution_id,
  e.status as execution_status,
  e.confidence_score,
  e.started_at,
  e.completed_at,
  t.status as ticket_status
FROM executions e
JOIN tickets t ON e.ticket_id = t.id
WHERE e.id = '5ccc99bb-2f5a-4104-9295-d5016992c6de';
