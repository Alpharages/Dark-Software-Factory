/**
 * Commit Response Parser Utility
 * Parses AI agent output to extract commit information
 *
 * Story 4.3: Git Commit Generation & Push
 * AC#3: Parse AI Agent Output
 */

import { CommitPushResult } from '../interfaces/commit-result.interface';

/**
 * Parses AI response for commit information
 * Try JSON first, fallback to regex extraction
 */
export function parseAIResponse(aiOutput: string): CommitPushResult {
  // Try JSON parse first (structured output)
  try {
    const json = JSON.parse(aiOutput);
    return {
      success: !!json.commitSha,
      commitSha: json.commitSha,
      filesChanged: json.filesChanged,
      commitMessage: json.commitMessage,
      error: json.error,
    };
  } catch {
    // Fallback: regex extraction from text output
    // Match format like: [main abc123...] or "commit abc123..."
    const shaMatch = aiOutput.match(/(?:commit\s+|[\s])([a-f0-9]{40})(?:[\s]|$)/i);
    if (shaMatch) {
      return {
        success: true,
        commitSha: shaMatch[1],
      };
    }

    return {
      success: false,
      error: 'Failed to extract commit SHA from AI output',
    };
  }
}

/**
 * Validates commit  SHA format (40-character hexadecimal)
 * Validate  const commitShaRegex = /\b([a-f0-9]{40})\b/i; // Unescaped brackets
 */
export function validateCommitSha(sha: string): boolean {
  return /^[a-f0-9]{40}$/i.test(sha);
}
