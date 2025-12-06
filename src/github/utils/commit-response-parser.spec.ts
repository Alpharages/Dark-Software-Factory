/**
 * Commit Response Parser Tests
 * Story 4.3: Git Commit Generation & Push
 */

import { parseAIResponse, validateCommitSha } from './commit-response-parser';

describe('CommitResponseParser', () => {
  describe('parseAIResponse', () => {
    it('should parse JSON structured output', () => {
      const jsonOutput = JSON.stringify({
        commitSha: 'abc123def456789012345678901234567890abcd',
        filesChanged: 5,
        commitMessage: 'feat(auth): add jwt tokens',
      });

      const result = parseAIResponse(jsonOutput);

      expect(result.success).toBe(true);
      expect(result.commitSha).toBe('abc123def456789012345678901234567890abcd');
      expect(result.filesChanged).toBe(5);
      expect(result.commitMessage).toBe('feat(auth): add jwt tokens');
      expect(result.error).toBeUndefined();
    });

    it('should handle JSON with error field', () => {
      const jsonOutput = JSON.stringify({
        error: 'Failed to push to remote',
      });

      const result = parseAIResponse(jsonOutput);

      expect(result.success).toBe(false);
      expect(result.commitSha).toBeUndefined();
      expect(result.error).toBe('Failed to push to remote');
    });

    it('should extract SHA from unstructured text with regex', () => {
      const textOutput = `
        Files staged successfully
        [main abc123def456789012345678901234567890abcd] feat(auth): add jwt
         5 files changed, 120 insertions(+)
        Pushed to origin/feature/auth-123
      `;

      const result = parseAIResponse(textOutput);

      expect(result.success).toBe(true);
      expect(result.commitSha).toBe('abc123def456789012345678901234567890abcd');
    });

    it('should extract SHA from git log output', () => {
      const gitOutput = 'commit 1234567890abcdef1234567890abcdef12345678';

      const result = parseAIResponse(gitOutput);

      expect(result.success).toBe(true);
      expect(result.commitSha).toBe('1234567890abcdef1234567890abcdef12345678');
    });

    it('should return error when no SHA found in text', () => {
      const textOutput = 'Some random output without a SHA';

      const result = parseAIResponse(textOutput);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to extract commit SHA from AI output');
    });

    it('should handle malformed JSON gracefully', () => {
      const malformedJson = '{ "commitSha": "abc123", unclosed';

      const result = parseAIResponse(malformedJson);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to extract commit SHA from AI output');
    });

    it('should be case-insensitive for commit keyword', () => {
      const upperCaseOutput = 'COMMIT abc123def456789012345678901234567890abcd done';

      const result = parseAIResponse(upperCaseOutput);

      expect(result.success).toBe(true);
      expect(result.commitSha).toBe('abc123def456789012345678901234567890abcd');
    });
  });

  describe('validateCommitSha', () => {
    it('should validate correct 40-char hex SHA', () => {
      expect(validateCommitSha('abc123def456789012345678901234567890abcd')).toBe(true);
      expect(validateCommitSha('1234567890abcdef1234567890abcdef12345678')).toBe(true);
      expect(validateCommitSha('ABCDEF1234567890ABCDEF1234567890ABCDEF12')).toBe(true);
    });

    it('should reject incorrect length SHAs', () => {
      expect(validateCommitSha('abc123')).toBe(false);
      expect(validateCommitSha('abc123def456789012345678901234567890abcd1234')).toBe(false);
      expect(validateCommitSha('')).toBe(false);
    });

    it('should reject non-hex characters', () => {
      expect(validateCommitSha('xyz123def456789012345678901234567890abcd')).toBe(false);
      expect(validateCommitSha('abc123-ef456789012345678901234567890abcd')).toBe(false);
    });
  });
});
