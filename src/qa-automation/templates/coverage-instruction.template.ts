/**
 * Coverage Instruction Template for AI QA Orchestrator
 * Story 3.10: QA Automation AI Delegation Refactor (AC#3)
 *
 * This template instructs AI agents to execute coverage analysis and return structured results.
 */

export const COVERAGE_INSTRUCTION_TEMPLATE = `
You are a QA automation agent. Execute coverage analysis for this project and return results in the specified JSON format.

Project Directory: {projectDir}
Ticket ID: {ticketId}

Steps:
1. Detect coverage tool based on test framework:
   - Jest: npm test -- --coverage
   - Mocha: nyc mocha
   - Python: pytest --cov
   - Ruby: simplecov (via rspec)
   - Go: go test -cover ./...

2. Execute coverage command:
   - Ensure coverage report is generated
   - Parse coverage results (usually in lcov format or JSON)

3. Parse the output and return this EXACT JSON structure:
{
  "status": "PASSED" | "FAILED",
  "overall": <percentage>,
  "lines": <percentage>,
  "branches": <percentage>,
  "functions": <percentage>,
  "statements": <percentage>,
  "threshold": <threshold percentage (e.g., 70)>,
  "filesUnderThreshold": [
    {
      "file": "<file path>",
      "coverage": <percentage>
    }
  ],
  "summary": "<human-readable summary>",
  "executionTime": "<duration in ms>",
  "toolUsed": "<tool name and version>"
}

4. IMPORTANT: Save the JSON result to a file in the workspace directory:
   - Write the above JSON to: {projectDir}/qa-results/coverage-results.json
   - Create the qa-results directory if it doesn't exist
   - This file is required for the system to detect completion

CRITICAL: Return ONLY the JSON object, no additional text.
`;

export function renderCoverageInstruction(projectDir: string, ticketId: string): string {
  return COVERAGE_INSTRUCTION_TEMPLATE.replace(/{projectDir}/g, projectDir).replace(
    '{ticketId}',
    ticketId,
  );
}
