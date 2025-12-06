import {
  generateConventionalCommit,
  determineCommitType,
  extractScope,
  generateShortDescription,
  generateLongDescription,
  validateCommitMessage,
} from './commit-message.util';
import { CommitType } from '../dto/commit-message.dto';

describe('CommitMessageUtil', () => {
  describe('determineCommitType', () => {
    it('should detect feat type', () => {
      expect(determineCommitType('Add new feature', 'Implement user login')).toBe(CommitType.FEAT);
      expect(determineCommitType('Create payment service', '')).toBe(CommitType.FEAT);
    });

    it('should detect fix type', () => {
      expect(determineCommitType('Fix authentication bug', '')).toBe(CommitType.FIX);
      expect(determineCommitType('Resolve memory leak', '')).toBe(CommitType.FIX);
    });

    it('should detect refactor type', () => {
      expect(determineCommitType('Refactor database layer', '')).toBe(CommitType.REFACTOR);
      expect(determineCommitType('Optimize query performance', '')).toBe(CommitType.REFACTOR);
    });

    it('should detect test type', () => {
      expect(determineCommitType('testing', 'testing feature spec')).toBe(CommitType.TEST);
      expect(determineCommitType('spec', 'Test coverage for auth')).toBe(CommitType.TEST);
    });

    it('should detect docs type', () => {
      expect(determineCommitType('Update README', '')).toBe(CommitType.DOCS);
      expect(determineCommitType('Document API endpoints', '')).toBe(CommitType.DOCS);
    });

    it('should detect chore type', () => {
      expect(determineCommitType('Update dependencies', '')).toBe(CommitType.CHORE);
      expect(determineCommitType('Upgrade node version', '')).toBe(CommitType.CHORE);
    });

    it('should default to feat if no keywords match', () => {
      expect(determineCommitType('Some random title', 'Random description')).toBe(CommitType.FEAT);
    });
  });

  describe('extractScope', () => {
    it('should extract scope from single module', () => {
      expect(extractScope(['src/auth/auth.service.ts'])).toBe('auth');
    });

    it('should skip src and use second directory', () => {
      expect(extractScope(['src/github/services/commit.service.ts'])).toBe('github');
    });

    it('should return "multiple" for multiple scopes', () => {
      expect(extractScope(['src/auth/auth.ts', 'src/github/github.ts'])).toBe('multiple');
    });

    it('should return "core" for empty file list', () => {
      expect(extractScope([])).toBe('core');
    });

    it('should return "core" for files without directories', () => {
      expect(extractScope(['README.md'])).toBe('core');
    });
  });

  describe('generateShortDescription', () => {
    it('should convert to lowercase', () => {
      expect(generateShortDescription('ADD NEW FEATURE')).toBe('add new feature');
    });

    it('should remove common prefixes', () => {
      expect(generateShortDescription('Story: Add authentication')).toBe('add authentication');
      expect(generateShortDescription('Feature: User login')).toBe('user login');
    });

    it('should convert to imperative mood', () => {
      expect(generateShortDescription('Added new feature')).toBe('add new feature');
      expect(generateShortDescription('Implements authentication')).toBe(
        'implement authentication',
      );
      expect(generateShortDescription('Fixed bug')).toBe('fix bug');
    });

    it('should truncate to 72 characters', () => {
      const longTitle =
        'This is a very long title that exceeds the maximum length allowed for commit subjects';
      const result = generateShortDescription(longTitle);
      expect(result.length).toBeLessThanOrEqual(72);
      expect(result).toContain('...');
    });
  });

  describe('generateLongDescription', () => {
    it('should include ticket summary', () => {
      const description = 'First sentence. Second sentence. Third sentence.';
      const result = generateLongDescription(description, []);
      expect(result).toContain('First sentence');
    });

    it('should include file list', () => {
      const files = ['src/auth/auth.ts', 'src/users/user.ts'];
      const result = generateLongDescription('Description', files);
      expect(result).toContain('src/auth/auth.ts');
      expect(result).toContain('src/users/user.ts');
    });

    it('should limit files to maxFiles parameter', () => {
      const files = Array(20)
        .fill(0)
        .map((_, i) => `file${i}.ts`);
      const result = generateLongDescription('Description', files, 5);
      expect(result).toContain('... and 15 more files');
    });
  });

  describe('generateConventionalCommit', () => {
    it('should generate complete commit message', () => {
      const result = generateConventionalCommit({
        ticketTitle: 'Add user authentication',
        ticketDescription: 'Implement JWT-based authentication for API',
        ticketId: 'DSF-123',
        filePaths: ['src/auth/auth.service.ts'],
        executionId: 'exec-123',
        aiProvider: 'CURSOR_HEADLESS',
        complexityScore: 75,
      });

      expect(result.type).toBe(CommitType.FEAT);
      expect(result.scope).toBe('auth');
      expect(result.subject).toContain('authentication');
      expect(result.ticketId).toBe('DSF-123');
      expect(result.executionId).toBe('exec-123');
      expect(result.aiProvider).toBe('CURSOR_HEADLESS');
      expect(result.complexityScore).toBe(75);
    });

    it('should generate valid commit message string', () => {
      const commitMsg = generateConventionalCommit({
        ticketTitle: 'Fix memory leak',
        ticketDescription: 'Resolve memory leak in cache service',
        ticketId: 'DSF-456',
        filePaths: ['src/cache/cache.service.ts'],
        executionId: 'exec-456',
        aiProvider: 'CLAUDE_CODE',
        complexityScore: 60,
      });

      const msgString = commitMsg.toString();
      expect(msgString).toContain('fix(cache):');
      expect(msgString).toContain('Implements: DSF-456');
      expect(msgString).toContain('AI-Generated: CLAUDE_CODE');
      expect(msgString).toContain('Execution-ID: exec-456');
      expect(msgString).toContain('Complexity: 60/100');
    });
  });

  describe('validateCommitMessage', () => {
    it('should validate complete commit message', () => {
      const validMsg = generateConventionalCommit({
        ticketTitle: 'Test',
        ticketDescription: 'Test',
        ticketId: 'DSF-1',
        filePaths: ['test.ts'],
        executionId: 'exec-1',
        aiProvider: 'TEST',
        complexityScore: 50,
      });

      const result = validateCommitMessage(validMsg);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect missing required fields', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const invalidMsg: any = {
        type: null,
        scope: null,
        subject: null,
        ticketId: null,
        executionId: null,
        complexityScore: -1,
      };

      const result = validateCommitMessage(invalidMsg);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should detect subject too long', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const msg: any = generateConventionalCommit({
        ticketTitle: 'Test',
        ticketDescription: 'Test',
        ticketId: 'DSF-1',
        filePaths: ['test.ts'],
        executionId: 'exec-1',
        aiProvider: 'TEST',
        complexityScore: 50,
      });
      msg.subject = 'a'.repeat(80);

      const result = validateCommitMessage(msg);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Commit subject must be ≤72 characters');
    });

    it('should detect invalid complexity score', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const msg: any = generateConventionalCommit({
        ticketTitle: 'Test',
        ticketDescription: 'Test',
        ticketId: 'DSF-1',
        filePaths: ['test.ts'],
        executionId: 'exec-1',
        aiProvider: 'TEST',
        complexityScore: 150,
      });
      msg.complexityScore = 150;

      const result = validateCommitMessage(msg);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Complexity score must be between 0 and 100');
    });
  });
});
