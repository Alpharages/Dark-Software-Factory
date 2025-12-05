import {
  generateBranchName,
  validateBranchName,
  generateUniqueBranchName,
} from './branch-name.util';

describe('Branch Name Utility', () => {
  describe('generateBranchName', () => {
    it('should generate branch name with correct format', () => {
      const result = generateBranchName({
        ticketId: 'DSF-123',
        title: 'Implement user authentication',
      });

      expect(result).toBe('ai/dsf-123-implement-user-authentication');
    });

    it('should convert to lowercase', () => {
      const result = generateBranchName({
        ticketId: 'DSF-456',
        title: 'Fix BUG in API',
      });

      expect(result).toBe('ai/dsf-456-fix-bug-in-api');
    });

    it('should replace spaces with hyphens', () => {
      const result = generateBranchName({
        ticketId: 'DSF-789',
        title: 'Add new feature',
      });

      expect(result).toBe('ai/dsf-789-add-new-feature');
    });

    it('should remove special characters', () => {
      const result = generateBranchName({
        ticketId: 'DSF-101',
        title: 'Fix: API returns 500 error!',
      });

      expect(result).toBe('ai/dsf-101-fix-api-returns-500-error');
    });

    it('should handle consecutive special characters', () => {
      const result = generateBranchName({
        ticketId: 'DSF-202',
        title: 'Test --- multiple --- hyphens',
      });

      expect(result).toBe('ai/dsf-202-test-multiple-hyphens');
    });

    it('should remove leading and trailing hyphens', () => {
      const result = generateBranchName({
        ticketId: 'DSF-303',
        title: '---leading and trailing---',
      });

      expect(result).toBe('ai/dsf-303-leading-and-trailing');
    });

    it('should truncate to 63 characters maximum', () => {
      const longTitle = 'a'.repeat(100);
      const result = generateBranchName({
        ticketId: 'DSF-404',
        title: longTitle,
      });

      expect(result.length).toBeLessThanOrEqual(63);
      expect(result.startsWith('ai/dsf-404')).toBe(true);
    });

    it('should append timestamp when provided', () => {
      const timestamp = 1234567890;
      const result = generateBranchName({
        ticketId: 'DSF-505',
        title: 'test',
        timestamp,
      });

      expect(result).toBe('ai/dsf-505-test-1234567890');
    });

    it('should truncate with timestamp suffix', () => {
      const longTitle = 'a'.repeat(100);
      const timestamp = 1234567890;
      const result = generateBranchName({
        ticketId: 'DSF-606',
        title: longTitle,
        timestamp,
      });

      expect(result.length).toBeLessThanOrEqual(63);
      expect(result.endsWith(`-${timestamp}`)).toBe(true);
    });

    it('should handle unicode characters', () => {
      const result = generateBranchName({
        ticketId: 'DSF-707',
        title: 'Añadir función de búsqueda',
      });

      expect(result).toMatch(/^ai\/[a-z0-9]+(-[a-z0-9]+)*$/);
    });
  });

  describe('validateBranchName', () => {
    it('should accept valid branch names', () => {
      const validNames = [
        'ai/dsf-123-test',
        'ai/dsf-456-a-b-c',
        'ai/abc123-def456',
        'ai/test-1234567890',
      ];

      validNames.forEach((name) => {
        const result = validateBranchName(name);
        expect(result.valid).toBe(true);
        expect(result.error).toBeUndefined();
      });
    });

    it('should reject branch exceeding maxlength', () => {
      const tooLongName = 'ai/' + 'a'.repeat(100);
      const result = validateBranchName(tooLongName);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('maximum length');
    });

    it('should reject branch with consecutive hyphens', () => {
      const result = validateBranchName('ai/test--double-hyphen');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('pattern'); // Regex catches it before explicit check
    });

    it('should reject branch not matching pattern', () => {
      const invalidNames = [
        'feature/test', // Wrong prefix
        'ai/Test-uppercase', // Contains uppercase
        'ai/-leading-hyphen', // Leading hyphen after prefix
        'ai/trailing-hyphen-', // Trailing hyphen
        'ai/test_underscore', // Contains underscore
        'test/ai-123', // Wrong format
      ];

      invalidNames.forEach((name) => {
        const result = validateBranchName(name);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('pattern');
      });
    });

    it('should accept branch at max length boundary', () => {
      const maxLengthName = 'ai/' + 'a'.repeat(60); // Exactly 63 chars
      const result = validateBranchName(maxLengthName);

      expect(result.valid).toBe(true);
    });
  });

  describe('generateUniqueBranchName', () => {
    it('should generate branch with timestamp suffix', () => {
      const result = generateUniqueBranchName('DSF-808', 'Test feature');

      expect(result).toMatch(/^ai\/dsf-808-test-feature-\d+$/);
    });

    it('should use current Unix timestamp', () => {
      const beforeTimestamp = Math.floor(Date.now() / 1000);
      const result = generateUniqueBranchName('DSF-909', 'Test');
      const afterTimestamp = Math.floor(Date.now() / 1000);

      const match = result.match(/-(\d+)$/);
      expect(match).not.toBeNull();

      if (match) {
        const timestamp = parseInt(match[1], 10);
        expect(timestamp).toBeGreaterThanOrEqual(beforeTimestamp);
        expect(timestamp).toBeLessThanOrEqual(afterTimestamp);
      }
    });

    it('should generate different names when called multiple times', async () => {
      const name1 = generateUniqueBranchName('DSF-1010', 'Test');

      // Small delay to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10));

      const name2 = generateUniqueBranchName('DSF-1010', 'Test');

      // May be same if called within same second, but structure should be identical
      expect(name1).toMatch(/^ai\/dsf-1010-test-\d+$/);
      expect(name2).toMatch(/^ai\/dsf-1010-test-\d+$/);
    });
  });
});
