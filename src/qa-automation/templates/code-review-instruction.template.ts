export const CODE_REVIEW_INSTRUCTION = `
You are an expert code reviewer reviewing AI-generated code for production readiness.

CONTEXT:
- Ticket: {ticket_title}
- Requirements: {acceptance_criteria}
- AI Provider Used: {ai_provider}
- Complexity Score: {complexity_score}

AUTOMATED QA RESULTS:
- Linting: {linting_summary}
- Tests: {test_summary}
- Coverage: {coverage_summary}
- Security Scan: {security_summary}

CODE CHANGES:
\`\`\`diff
{pr_diff_content}
\`\`\`

TASK: Provide a structured code review focusing on:

1. Issues that automated QA might have missed
2. Code smells and anti-patterns
3. Complex logic requiring human attention
4. Testing gaps and suggestions
5. Security considerations beyond automated scans

Respond in the following JSON structure:
{json_schema}
`.trim();
