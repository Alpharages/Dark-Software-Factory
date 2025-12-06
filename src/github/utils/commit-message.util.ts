import { CommitMessageDto, CommitType } from '../dto/commit-message.dto';

/**
 * Commit Message Generation Utility
 * AC#2: Conventional Commit Message Generation
 *
 * Generates conventional commit messages from ticket context
 */

/**
 * Keywords for commit type determination
 */
const COMMIT_TYPE_KEYWORDS = {
  [CommitType.FEAT]: ['add', 'implement', 'create', 'new feature', 'introduce'],
  [CommitType.FIX]: ['fix', 'resolve', 'bug', 'issue', 'repair', 'correct'],
  [CommitType.REFACTOR]: ['refactor', 'restructure', 'optimize', 'improve', 'reorganize'],
  [CommitType.TEST]: ['test', 'testing', 'spec', 'coverage'],
  [CommitType.DOCS]: ['document', 'readme', 'documentation', 'docs'],
  [CommitType.CHORE]: ['update', 'upgrade', 'dependency', 'maintain', 'config'],
};

/**
 * Determines commit type from ticket title and description
 */
export function determineCommitType(title: string, description: string): CommitType {
  const combined = `${title} ${description}`.toLowerCase();

  // Check each type's keywords
  for (const [type, keywords] of Object.entries(COMMIT_TYPE_KEYWORDS)) {
    if (keywords.some((keyword) => combined.includes(keyword))) {
      return type as CommitType;
    }
  }

  // Default to feat if no keywords match
  return CommitType.FEAT;
}

/**
 * Extracts scope from file paths
 * Uses first directory in path: src/auth/ → scope: auth
 */
export function extractScope(filePaths: string[]): string {
  if (filePaths.length === 0) {
    return 'core';
  }

  // Extract unique scopes from all file paths
  const scopes = new Set<string>();

  for (const path of filePaths) {
    // Remove leading slash if present
    const normalized = path.startsWith('/') ? path.substring(1) : path;

    // Split path and get first directory
    const parts = normalized.split('/');
    if (parts.length > 1) {
      // Skip 'src' if it's the first part
      const scope = parts[0] === 'src' && parts.length > 2 ? parts[1] : parts[0];
      scopes.add(scope);
    }
  }

  // If multiple scopes, return "multiple", else return the single scope
  if (scopes.size === 0) {
    return 'core';
  } else if (scopes.size === 1) {
    return Array.from(scopes)[0];
  } else {
    return 'multiple';
  }
}

/**
 * Generates short description from ticket title
 * Max 72 characters, lowercase, imperative mood
 */
export function generateShortDescription(title: string): string {
  // Convert to lowercase
  let description = title.toLowerCase();

  // Remove common prefixes
  description = description.replace(/^(story|task|epic|feature|bug)[\s:-]+/i, '');

  // Convert to imperative mood (basic heuristics)
  description = description.replace(/^(adds|added|adding)\s+/, 'add ');
  description = description.replace(/^(implements|implemented|implementing)\s+/, 'implement ');
  description = description.replace(/^(fixes|fixed|fixing)\s+/, 'fix ');
  description = description.replace(/^(updates|updated|updating)\s+/, 'update ');
  description = description.replace(/^(refactors|refactored|refactoring)\s+/, 'refactor ');

  // Truncate to 72 characters
  if (description.length > 72) {
    description = description.substring(0, 69) + '...';
  }

  return description.trim();
}

/**
 * Generates longer description from ticket description and file list
 */
export function generateLongDescription(
  ticketDescription: string,
  filePaths: string[],
  maxFiles: number = 10,
): string {
  // Extract first 3-5 sentences from ticket description
  const sentences = ticketDescription.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const summary = sentences.slice(0, Math.min(5, sentences.length)).join('. ') + '.';

  // Add file list
  const fileList = filePaths.slice(0, maxFiles);
  const filesSection = ['', 'Key files changed:', ...fileList.map((path) => `- ${path}`)];

  if (filePaths.length > maxFiles) {
    filesSection.push(`... and ${filePaths.length - maxFiles} more files`);
  }

  return summary + '\n' + filesSection.join('\n');
}

/**
 * Generates complete conventional commit message
 */
export function generateConventionalCommit(params: {
  ticketTitle: string;
  ticketDescription: string;
  ticketId: string;
  filePaths: string[];
  executionId: string;
  aiProvider: string;
  complexityScore: number;
}): CommitMessageDto {
  const commitMessage = new CommitMessageDto();

  // Determine type from ticket content
  commitMessage.type = determineCommitType(params.ticketTitle, params.ticketDescription);

  // Extract scope from file paths
  commitMessage.scope = extractScope(params.filePaths);

  // Generate short description
  commitMessage.subject = generateShortDescription(params.ticketTitle);

  // Generate longer description
  commitMessage.body = generateLongDescription(params.ticketDescription, params.filePaths);

  // Add metadata
  commitMessage.ticketId = params.ticketId;
  commitMessage.aiProvider = params.aiProvider;
  commitMessage.executionId = params.executionId;
  commitMessage.complexityScore = params.complexityScore;

  return commitMessage;
}

/**
 * Validates commit message format
 */
export function validateCommitMessage(message: CommitMessageDto): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!message.type) {
    errors.push('Commit type is required');
  }

  if (!message.scope) {
    errors.push('Commit scope is required');
  }

  if (!message.subject) {
    errors.push('Commit subject is required');
  }

  if (message.subject && message.subject.length > 72) {
    errors.push('Commit subject must be ≤72 characters');
  }

  if (!message.ticketId) {
    errors.push('Ticket ID is required in metadata');
  }

  if (!message.executionId) {
    errors.push('Execution ID is required in metadata');
  }

  if (message.complexityScore < 0 || message.complexityScore > 100) {
    errors.push('Complexity score must be between 0 and 100');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
