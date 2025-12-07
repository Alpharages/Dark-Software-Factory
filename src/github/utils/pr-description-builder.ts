/**
 * PR Description Builder Utility
 * Generates rich markdown PR descriptions from ticket + QA + AI context
 *
 * Story 4.4: Pull Request Creation & Metadata
 * AC#2: PR Description Template
 */

export interface PRDescriptionContext {
  ticketId: string;
  ticketUrl: string;
  ticketTitle: string;
  acceptanceCriteria: string[];
  aiProvider: string;
  complexityScore: number;
  confidenceScore: number;
  executionId: string;
  fallbackUsed: boolean;
  qaResults: {
    linting_passed: boolean;
    tests_passed: boolean;
    test_coverage?: number;
    code_review_passed: boolean;
    qa_summary_details: string;
  };
}

/**
 * Builds PR description markdown from ticket, QA, and AI context
 * Follows template defined in AC#2
 */
export function buildPRDescription(context: PRDescriptionContext): string {
  const {
    ticketId,
    ticketUrl,
    ticketTitle,
    acceptanceCriteria,
    aiProvider,
    complexityScore,
    confidenceScore,
    executionId,
    fallbackUsed,
    qaResults,
  } = context;

  // Format acceptance criteria as markdown checklist
  const acChecklist =
    acceptanceCriteria.length > 0
      ? acceptanceCriteria.map((ac) => `- [ ] ${ac}`).join('\n')
      : '_No acceptance criteria specified_';

  // Format QA results with emoji indicators
  const lintingStatus = qaResults.linting_passed ? '✅ Passed' : '❌ Failed';
  const testsStatus = qaResults.tests_passed ? '✅ Passed' : '❌ Failed';
  const coverageStatus = qaResults.test_coverage
    ? qaResults.test_coverage >= 80
      ? `✅ ${qaResults.test_coverage}%`
      : `⚠️ ${qaResults.test_coverage}%`
    : '⚠️ Not measured';
  const securityStatus = qaResults.code_review_passed
    ? '✅ No vulnerabilities'
    : '⚠️ Issues detected';

  // Build markdown template
  return `## Ticket Reference

ClickUp: [${ticketId}](${ticketUrl})

## Changes

_AI-generated code changes for: ${ticketTitle}_

## Acceptance Criteria

${acChecklist}

## AI Context

- **Provider:** ${aiProvider}
- **Complexity Score:** ${complexityScore}/100
- **Confidence:** ${confidenceScore}%
- **Execution ID:** ${executionId}
- **Fallback Used:** ${fallbackUsed ? 'Yes' : 'No'}

## QA Results

- **Linting:** ${lintingStatus}
- **Tests:** ${testsStatus}
- **Coverage:** ${coverageStatus}
- **Security:** ${securityStatus}

${qaResults.qa_summary_details}
`;
}
