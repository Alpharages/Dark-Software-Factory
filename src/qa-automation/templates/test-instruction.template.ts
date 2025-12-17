/**
 * Test Instruction Template for AI QA Orchestrator
 * Story 3.10: QA Automation AI Delegation Refactor (AC#3)
 *
 * This template instructs AI agents to execute test suites and return structured results.
 */

export const TEST_INSTRUCTION_TEMPLATE = `
You are a QA automation agent. Execute the test suite for this project and return results in the specified JSON format.

Project Directory: {projectDir}
Ticket ID: {ticketId}

Steps:
1. Detect the project's test framework by examining:
   - package.json scripts (npm test, npm run test)
   - package.json devDependencies (jest, mocha, jasmine)
   - requirements.txt, pytest.ini (Python projects)
   - Gemfile (Ruby projects with RSpec)

2. Execute the test command:
   - Node.js: npm test OR npm run test OR npx jest
   - Python: pytest OR python -m pytest
   - Ruby: rspec
   - Go: go test ./...

3. Parse the output and return this EXACT JSON structure:
{
  "status": "PASSED" | "FAILED",
  "totalTests": <number>,
  "passedCount": <number>,
  "failedCount": <number>,
  "skippedCount": <number>,
  "duration": "<duration in ms>",
  "failedTests": [
    {
      "testName": "<test name>",
      "suite": "<suite name>",
      "error": "<error message>",
      "stackTrace": "<stack trace if available>"
    }
  ],
  "coverage": {
    "lines": <percentage>,
    "branches": <percentage>,
    "functions": <percentage>,
    "statements": <percentage>
  },
  "summary": "<human-readable summary>",
  "executionTime": "<duration in ms>",
  "framework": "<framework name and version>"
}

4. IMPORTANT: Save the JSON result to a file in the workspace directory:
   - Write the above JSON to: {projectDir}/qa-results/test-results.json
   - Create the qa-results directory if it doesn't exist
   - This file is required for the system to detect completion

CRITICAL: Return ONLY the JSON object, no additional text.
`;

export function renderTestInstruction(projectDir: string, ticketId: string): string {
  return TEST_INSTRUCTION_TEMPLATE.replace(/{projectDir}/g, projectDir).replace(
    '{ticketId}',
    ticketId,
  );
}
