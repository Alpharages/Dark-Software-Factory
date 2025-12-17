/**
 * Security Instruction Template for AI QA Orchestrator
 * Story 3.10: QA Automation AI Delegation Refactor (AC#3)
 *
 * This template instructs AI agents to execute security scans and return structured results.
 */

export const SECURITY_INSTRUCTION_TEMPLATE = `
You are a QA automation agent. Execute security scans for this project and return results in the specified JSON format.

Project Directory: {projectDir}
Ticket ID: {ticketId}

Steps:
1. Detect available security tools:
   - Node.js: npm audit, snyk
   - Python: bandit, safety
   - Ruby: brakeman, bundler-audit
   - Go: gosec

2. Execute security scans:
   - Dependency vulnerabilities: npm audit OR pip-audit OR bundle-audit
   - Code patterns: bandit (Python) OR brakeman (Ruby) OR gosec (Go)
   - Secret detection: grep for API keys, tokens, passwords in code

3. Parse the output and return this EXACT JSON structure:
{
  "status": "PASSED" | "FAILED",
  "criticalCount": <number>,
  "highCount": <number>,
  "mediumCount": <number>,
  "lowCount": <number>,
  "findings": [
    {
      "severity": "critical" | "high" | "medium" | "low",
      "type": "vulnerability" | "secret" | "pattern",
      "title": "<finding title>",
      "description": "<description>",
      "file": "<file path if applicable>",
      "line": <line number if applicable>,
      "recommendation": "<fix recommendation>"
    }
  ],
  "summary": "<human-readable summary>",
  "executionTime": "<duration in ms>",
  "toolsUsed": ["<tool 1>", "<tool 2>"]
}

4. IMPORTANT: Save the JSON result to a file in the workspace directory:
   - Write the above JSON to: {projectDir}/qa-results/security-results.json
   - Create the qa-results directory if it doesn't exist
   - This file is required for the system to detect completion

CRITICAL: Return ONLY the JSON object, no additional text.
`;

export function renderSecurityInstruction(projectDir: string, ticketId: string): string {
  return SECURITY_INSTRUCTION_TEMPLATE.replace(/{projectDir}/g, projectDir).replace(
    '{ticketId}',
    ticketId,
  );
}
