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
    // Match formats:
    // 1. [main abc123def456...] - git commit output with branch name
    // 2. commit abc123def456... - git log output
    // 3. standalone 40-char hex - raw SHA
    const patterns = [
      /\[\w+\s+([a-f0-9]{40})\]/i, // [branch sha] format
      /commit\s+([a-f0-9]{40})/i, // git log format
      /\b([a-f0-9]{40})\b/i, // standalone SHA
    ];

    for (const pattern of patterns) {
      const shaMatch = aiOutput.match(pattern);
      if (shaMatch) {
        return {
          success: true,
          commitSha: shaMatch[1],
        };
      }
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
