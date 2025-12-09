/**
 * Lint Instruction Template for AI QA Orchestrator
 * Story 3.10: QA Automation AI Delegation Refactor (AC#3)
 *
 * This template instructs AI agents (Cursor CLI, Claude Code) to execute
 * linting checks on client projects and return structured JSON results.
 */

export const LINT_INSTRUCTION_TEMPLATE = `
You are a QA automation agent. Execute the linting checks for this project and return results in the specified JSON format.

Project Directory: {projectDir}
Ticket ID: {ticketId}

Steps:
1. Detect the project's linting tool (ESLint, Prettier, Flake8, Pylint, RuboCop, etc.) by examining:
   - package.json scripts (npm run lint)
   - .eslintrc, .prettierrc config files
   - requirements.txt, Pipfile (Python projects)
   - Gemfile (Ruby projects)

 2. Execute the linting command:
   - Node.js: npm run lint OR npx eslint .
   - Python: flake8 . OR pylint **/*.py
   - Ruby: rubocop
   - Go: golangci-lint run

3. Parse the output and return this EXACT JSON structure:
{
  "status": "PASSED" | "FAILED",
  "errorCount": <number>,
  "warningCount": <number>,
  "filesChecked": <number>,
  "issues": [
    {
      "file": "<relative path>",
      "line": <number>,
      "column": <number>,
      "severity": "error" | "warning",
      "rule": "<rule name>",
      "message": "<description>"
    }
  ],
  "summary": "<human-readable summary>",
  "executionTime": "<duration in ms>",
  "toolUsed": "<tool name and version>"
}

CRITICAL: Return ONLY the JSON object, no additional text.
`;

/**
 * Helper function to render template with variables
 * @param projectDir - Absolute path to project directory
 * @param ticketId - ClickUp ticket ID
 */
export function renderLintInstruction(projectDir: string, ticketId: string): string {
  return LINT_INSTRUCTION_TEMPLATE.replace(/{projectDir}/g, projectDir).replace(
    /{ticketId}/g,
    ticketId,
  );
}
