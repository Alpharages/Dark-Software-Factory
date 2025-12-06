/**
 * Commit Message Context Utility
 * Builds conventional commit message context from ticket and files
 *
 * Story 4.3: Git Commit Generation & Push
 * AC#2: Conventional Commit Message Requirements
 */

import { CommitMessageMetadata } from '../interfaces/commit-task.interface';

export interface CommitTypeKeywords {
  feat: string[];
  fix: string[];
  refactor: string[];
  test: string[];
  docs: string[];
}

const COMMIT_TYPE_KEYWORDS: CommitTypeKeywords = {
  feat: ['add', 'implement', 'create', 'new', 'feature'],
  fix: ['fix', 'resolve', 'bug', 'issue', 'error', 'correct'],
  refactor: ['refactor', 'improve', 'optimize', 'clean', 'restructure'],
  test: ['test', 'testing', 'spec', 'coverage'],
  docs: ['document', 'docs', 'documentation', 'readme'],
};

/**
 * Determines commit type from ticket title and description
 * AC#2: Type Determination
 */
export function determineCommitType(
  ticketTitle: string,
  ticketDescription?: string,
): 'feat' | 'fix' | 'refactor' | 'test' | 'docs' | 'chore' {
  const text = `${ticketTitle} ${ticketDescription || ''}`.toLowerCase();

  // Check each type's keywords
  for (const [type, keywords] of Object.entries(COMMIT_TYPE_KEYWORDS)) {
    if (keywords.some((keyword: string) => text.includes(keyword))) {
      return type as 'feat' | 'fix' | 'refactor' | 'test' | 'docs';
    }
  }

  // Default to 'feat' for new features
  return 'feat';
}

/**
 * Extracts scope from changed files
 * AC#2: Conventional commit format
 *
 * Examples:
 * - src/auth/user.service.ts → 'auth'
 * - src/github/services/branch.service.ts → 'github'
 * - docs/README.md → 'docs'
 */
export function extractScope(filePaths: string[]): string {
  if (!filePaths || filePaths.length === 0) {
    return 'general';
  }

  // Get the first directory after 'src' or root
  const firstFilePath = filePaths[0];
  const parts = firstFilePath.split('/');

  // Find 'src' or use first directory
  const srcIndex = parts.indexOf('src');
  if (srcIndex >= 0 && parts.length > srcIndex + 1) {
    return parts[srcIndex + 1];
  }

  // Fallback: use first directory
  return parts[0] || 'general';
}

/**
 * Builds conventional commit message template
 * AC#2: Format specification
 */
export function buildCommitMessage(metadata: CommitMessageMetadata, bodyText?: string): string {
  const { type, scope, description, ticketId, aiProvider, executionId, complexityScore } = metadata;

  const header = `${type}(${scope}): ${description}`;
  const body = bodyText || '';
  const footer = `
Implements: ${ticketId}
AI-Generated: ${aiProvider}
Execution-ID: ${executionId}
Complexity: ${complexityScore}/100`;

  return `${header}\n\n${body}\n${footer}`.trim();
}

/**
 * Creates commit message context for AI task
 * Used in delegation task instructions
 */
export function createCommitMessageContext(
  ticketId: string,
  ticketTitle: string,
  ticketDescription: string | undefined,
  filePaths: string[],
  aiProvider: string,
  executionId: string,
  complexityScore: number,
): CommitMessageMetadata {
  const type = determineCommitType(ticketTitle, ticketDescription);
  const scope = extractScope(filePaths);
  const description = ticketTitle
    .toLowerCase()
    .replace(/^(feat|fix|refactor|test|docs|chore):\s*/i, '');

  return {
    type,
    scope,
    description,
    ticketId,
    aiProvider,
    executionId,
    complexityScore,
  };
}
