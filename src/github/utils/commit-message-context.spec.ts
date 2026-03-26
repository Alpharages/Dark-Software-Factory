/**
 * Commit Message Context Tests
 * Story 4.3: Git Commit Generation & Push
 */

import {
  determineCommitType,
  extractScope,
  buildCommitMessage,
  createCommitMessageContext,
} from './commit-message-context';
import { CommitMessageMetadata } from '../interfaces/commit-task.interface';

describe('CommitMessageContext', () => {
  describe('determineCommitType', () => {
    it('should detect feat type from keywords', () => {
      expect(determineCommitType('Add user authentication')).toBe('feat');
      expect(determineCommitType('Implement JWT tokens')).toBe('feat');
      expect(determineCommitType('Create new dashboard')).toBe('feat');
    });

    it('should detect fix type from keywords', () => {
      expect(determineCommitType('Fix login bug')).toBe('fix');
      expect(determineCommitType('Resolve rate limit issue')).toBe('fix');
      expect(determineCommitType('Correct validation error')).toBe('fix');
    });

    it('should detect refactor type from keywords', () => {
      expect(determineCommitType('Refactor auth service')).toBe('refactor');
      expect(determineCommitType('Improve code structure')).toBe('refactor');
      expect(determineCommitType('Optimize database queries')).toBe('refactor');
    });

    it('should detect test type from keywords', () => {
      expect(determineCommitType('Write unit tests')).toBe('test');
      expect(determineCommitType('Run test coverage analysis')).toBe('test');
    });
    it('should detect docs type from keywords', () => {
      expect(determineCommitType('Document API endpoints')).toBe('docs');
      expect(determineCommitType('Update README')).toBe('docs');
    });

    it('should default to feat for unknown types', () => {
      expect(determineCommitType('Random task')).toBe('feat');
      expect(determineCommitType('')).toBe('feat');
    });

    it('should check both title and description', () => {
      expect(determineCommitType('Update system', 'Fix critical bug')).toBe('fix');
    });
  });

  describe('extractScope', () => {
    it('should extract scope from src directory', () => {
      expect(extractScope(['src/auth/user.service.ts'])).toBe('auth');
      expect(extractScope(['src/github/services/branch.service.ts'])).toBe('github');
      expect(extractScope(['src/database/prisma.service.ts'])).toBe('database');
    });

    it('should handle non-src paths', () => {
      expect(extractScope(['docs/README.md'])).toBe('docs');
      expect(extractScope(['config/env.ts'])).toBe('config');
    });

    it('should return general for empty paths', () => {
      expect(extractScope([])).toBe('general');
    });

    it('should use first file path when multiple', () => {
      expect(extractScope(['src/auth/user.service.ts', 'src/database/user.repo.ts'])).toBe('auth');
    });
  });

  describe('buildCommitMessage', () => {
    it('should build conventional commit message', () => {
      const metadata: CommitMessageMetadata = {
        type: 'feat',
        scope: 'auth',
        description: 'add jwt token refresh',
        ticketId: 'DSF-245',
        aiProvider: 'CLAUDE_CODE',
        executionId: '550e8400-e29b-41d4-a716-446655440000',
        complexityScore: 72,
      };

      const message = buildCommitMessage(metadata);

      expect(message).toContain('feat(auth): add jwt token refresh');
      expect(message).toContain('Implements: DSF-245');
      expect(message).toContain('AI-Generated: CLAUDE_CODE');
      expect(message).toContain('Execution-ID: 550e8400-e29b-41d4-a716-446655440000');
      expect(message).toContain('Complexity: 72/100');
    });

    it('should include body text if provided', () => {
      const metadata: CommitMessageMetadata = {
        type: 'fix',
        scope: 'github',
        description: 'resolve rate limit retry logic',
        ticketId: 'DSF-248',
        aiProvider: 'CLAUDE_CODE',
        executionId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
        complexityScore: 45,
      };

      const message = buildCommitMessage(
        metadata,
        'Fixes infinite retry loop when rate limit headers are missing.',
      );

      expect(message).toContain('fix(github): resolve rate limit retry logic');
      expect(message).toContain('Fixes infinite retry loop');
      expect(message).toContain('Implements: DSF-248');
    });
  });

  describe('createCommitMessageContext', () => {
    it('should create complete commit context', () => {
      const context = createCommitMessageContext(
        'DSF-245',
        'Add JWT token refresh mechanism',
        'Implements automatic token refresh',
        ['src/auth/refresh-token.service.ts'],
        'CLAUDE_CODE',
        '550e8400-e29b-41d4-a716-446655440000',
        72,
      );

      expect(context.type).toBe('feat');
      expect(context.scope).toBe('auth');
      expect(context.description).toContain('jwt token refresh');
      expect(context.ticketId).toBe('DSF-245');
      expect(context.aiProvider).toBe('CLAUDE_CODE');
      expect(context.executionId).toBe('550e8400-e29b-41d4-a716-446655440000');
      expect(context.complexityScore).toBe(72);
    });

    it('should strip type prefix from description', () => {
      const context = createCommitMessageContext(
        'DSF-246',
        'feat: add user profiles',
        undefined,
        ['src/users/profile.service.ts'],
        'CLAUDE_CODE',
        'exec-123',
        50,
      );

      expect(context.description).toBe('add user profiles');
      expect(context.description).not.toContain('feat:');
    });
  });
});
