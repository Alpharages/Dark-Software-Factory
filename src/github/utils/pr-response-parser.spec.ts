/**
 * PR Response Parser Tests
 * Story 4.4: Pull Request Creation & Metadata
 * AC#3: Parse AI Agent Output
 */

import { parseAIPRResponse, PRCreationResult } from './pr-response-parser';

describe('parseAIPRResponse', () => {
  it('should parse JSON output (structured)', () => {
    const jsonOutput = JSON.stringify({
      prUrl: 'https://github.com/org/repo/pull/42',
      prNumber: 42,
    });

    const result: PRCreationResult = parseAIPRResponse(jsonOutput);

    expect(result.success).toBe(true);
    expect(result.prUrl).toBe('https://github.com/org/repo/pull/42');
    expect(result.prNumber).toBe(42);
    expect(result.error).toBeUndefined();
  });

  it('should extract PR URL via regex (unstructured text)', () => {
    const textOutput = `
Pull request created successfully!
URL: https://github.com/dark-factory/ai-orchestrator/pull/123
Status: Open
    `;

    const result: PRCreationResult = parseAIPRResponse(textOutput);

    expect(result.success).toBe(true);
    expect(result.prUrl).toBe('https://github.com/dark-factory/ai-orchestrator/pull/123');
    expect(result.prNumber).toBe(123);
  });

  it('should handle JSON with error field', () => {
    const jsonOutput = JSON.stringify({
      error: 'GitHub API rate limit exceeded',
    });

    const result: PRCreationResult = parseAIPRResponse(jsonOutput);

    expect(result.success).toBe(false);
    expect(result.error).toBe('GitHub API rate limit exceeded');
  });

  it('should validate PR URL format', () => {
    const invalidUrl = JSON.stringify({
      prUrl: 'invalid-url',
      prNumber: 42,
    });

    const result: PRCreationResult = parseAIPRResponse(invalidUrl);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid PR URL format');
  });

  it('should return error for missing PR URL', () => {
    const missingUrl = JSON.stringify({
      prNumber: 42,
    });

    const result: PRCreationResult = parseAIPRResponse(missingUrl);

    expect(result.success).toBe(false);
    expect(result.error).toContain('No PR URL found');
  });

  it('should handle malformed output gracefully', () => {
    const malformedOutput = 'This is not JSON and has no PR URL';

    const result: PRCreationResult = parseAIPRResponse(malformedOutput);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Failed to extract PR URL from AI output');
  });

  it('should extract PR number from URL correctly', () => {
    const textOutput = 'Created PR: https://github.com/org/repo/pull/9999';

    const result: PRCreationResult = parseAIPRResponse(textOutput);

    expect(result.prNumber).toBe(9999);
  });

  it('should handle different GitHub URL formats', () => {
    const outputs = [
      'https://github.com/org/repo/pull/1',
      'https://github.com/my-org/my-repo/pull/456',
      'https://github.com/a/b/pull/789',
    ];

    outputs.forEach((url) => {
      const result: PRCreationResult = parseAIPRResponse(url);
      expect(result.success).toBe(true);
      expect(result.prUrl).toBe(url);
    });
  });

  it('should handle JSON with both prUrl and pr_url fields', () => {
    // Some AI agents might use snake_case
    const jsonOutput = JSON.stringify({
      pr_url: 'https://github.com/org/repo/pull/42',
      pr_number: 42,
    });

    const result: PRCreationResult = parseAIPRResponse(jsonOutput);

    expect(result.success).toBe(true);
    expect(result.prUrl).toBe('https://github.com/org/repo/pull/42');
    expect(result.prNumber).toBe(42);
  });
});
