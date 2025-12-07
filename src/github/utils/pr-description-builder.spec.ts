/**
 * PR Description Builder Tests
 * Story 4.4: Pull Request Creation & Metadata
 * AC#2: PR Description Template
 */

import { buildPRDescription, PRDescriptionContext } from './pr-description-builder';

describe('buildPRDescription', () => {
  const baseContext: PRDescriptionContext = {
    ticketId: 'DSF-245',
    ticketUrl: 'https://app.clickup.com/t/DSF-245',
    ticketTitle: 'Implement user authentication',
    acceptanceCriteria: [
      'Users can log in with email/password',
      'JWT tokens are generated',
      'Passwords are hashed with bcrypt',
    ],
    aiProvider: 'CURSOR_HEADLESS',
    complexityScore: 75,
    confidenceScore: 92,
    executionId: '123e4567-e89b-12d3-a456-426614174000',
    fallbackUsed: false,
    qaResults: {
      linting_passed: true,
      tests_passed: true,
      test_coverage: 85,
      code_review_passed: true,
      qa_summary_details: 'All quality checks passed',
    },
  };

  it('should generate markdown with all sections', () => {
    const result = buildPRDescription(baseContext);

    expect(result).toContain('## Ticket Reference');
    expect(result).toContain('## Changes');
    expect(result).toContain('## Acceptance Criteria');
    expect(result).toContain('## AI Context');
    expect(result).toContain('## QA Results');
  });

  it('should format ticket reference with ClickUp URL', () => {
    const result = buildPRDescription(baseContext);

    expect(result).toContain('ClickUp: [DSF-245](https://app.clickup.com/t/DSF-245)');
  });

  it('should format QA results when all passing', () => {
    const result = buildPRDescription(baseContext);

    expect(result).toContain('**Linting:** ✅ Passed');
    expect(result).toContain('**Tests:** ✅ Passed');
    expect(result).toContain('**Coverage:** ✅ 85%');
    expect(result).toContain('**Security:** ✅ No vulnerabilities');
  });

  it('should format QA results when some failing', () => {
    const failingContext: PRDescriptionContext = {
      ...baseContext,
      qaResults: {
        linting_passed: false,
        tests_passed: true,
        test_coverage: 65,
        code_review_passed: false,
        qa_summary_details: '2 security issues detected',
      },
    };

    const result = buildPRDescription(failingContext);

    expect(result).toContain('**Linting:** ❌ Failed');
    expect(result).toContain('**Tests:** ✅ Passed');
    expect(result).toContain('**Coverage:** ⚠️ 65%');
    expect(result).toContain('**Security:** ⚠️ Issues detected');
    expect(result).toContain('2 security issues detected');
  });

  it('should include AI metadata', () => {
    const result = buildPRDescription(baseContext);

    expect(result).toContain('**Provider:** CURSOR_HEADLESS');
    expect(result).toContain('**Complexity Score:** 75/100');
    expect(result).toContain('**Confidence:** 92%');
    expect(result).toContain('**Execution ID:** 123e4567-e89b-12d3-a456-426614174000');
    expect(result).toContain('**Fallback Used:** No');
  });

  it('should show fallback used when true', () => {
    const fallbackContext: PRDescriptionContext = {
      ...baseContext,
      fallbackUsed: true,
    };

    const result = buildPRDescription(fallbackContext);

    expect(result).toContain('**Fallback Used:** Yes');
  });

  it('should generate acceptance criteria checklist', () => {
    const result = buildPRDescription(baseContext);

    expect(result).toContain('- [ ] Users can log in with email/password');
    expect(result).toContain('- [ ] JWT tokens are generated');
    expect(result).toContain('- [ ] Passwords are hashed with bcrypt');
  });

  it('should handle empty acceptance criteria', () => {
    const noACContext: PRDescriptionContext = {
      ...baseContext,
      acceptanceCriteria: [],
    };

    const result = buildPRDescription(noACContext);

    expect(result).toContain('## Acceptance Criteria');
    expect(result).toContain('_No acceptance criteria specified_');
  });

  it('should output valid markdown', () => {
    const result = buildPRDescription(baseContext);

    // Check for markdown headers
    expect(result).toMatch(/^##\s/m);
    // Check for markdown links
    expect(result).toMatch(/\[.*\]\(.*\)/);
    // Check for markdown checkboxes
    expect(result).toMatch(/- \[ \]/);
    // Check for bold text
    expect(result).toMatch(/\*\*.*\*\*/);
  });

  it('should handle missing coverage gracefully', () => {
    const noCoverageContext: PRDescriptionContext = {
      ...baseContext,
      qaResults: {
        ...baseContext.qaResults,
        test_coverage: undefined,
      },
    };

    const result = buildPRDescription(noCoverageContext);

    expect(result).toContain('**Coverage:** ⚠️ Not measured');
  });
});
