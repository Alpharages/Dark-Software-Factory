/**
 * PR Response Parser Utility
 * Parses AI agent output to extract PR URL and number
 *
 * Story 4.4: Pull Request Creation & Metadata
 * AC#3: Parse AI Agent Output
 */

export interface PRCreationResult {
  success: boolean;
  prUrl?: string;
  prNumber?: number;
  error?: string;
}

/**
 * Parses AI response for PR information
 * Try JSON first (structured output), fallback to regex extraction
 * Pattern: Exact replica of commit-response-parser.ts logic
 */
export function parseAIPRResponse(aiOutput: string): PRCreationResult {
  // Try JSON parse first (structured output)
  try {
    const json = JSON.parse(aiOutput);

    // Check for error in JSON response
    if (json.error) {
      return {
        success: false,
        error: json.error,
      };
    }

    // Support both camelCase (prUrl) and snake_case (pr_url) from AI agents
    const prUrl = json.prUrl || json.pr_url;
    const prNumber = json.prNumber || json.pr_number;

    // Validate PR URL is present
    if (!prUrl) {
      return {
        success: false,
        error: 'No PR URL found in AI response',
      };
    }

    // Validate PR URL format
    if (!isValidGitHubPRUrl(prUrl)) {
      return {
        success: false,
        error: 'Invalid PR URL format in AI response',
      };
    }

    return {
      success: true,
      prUrl,
      prNumber: prNumber || extractPRNumber(prUrl),
    };
  } catch {
    // Fallback: regex extraction from text output
    // Match format: https://github.com/{org}/{repo}/pull/{number}
    const urlMatch = aiOutput.match(/https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/(\d+)/);

    if (urlMatch) {
      const prUrl = urlMatch[0];
      const prNumber = parseInt(urlMatch[1], 10);

      return {
        success: true,
        prUrl,
        prNumber,
      };
    }

    return {
      success: false,
      error: 'Failed to extract PR URL from AI output',
    };
  }
}

/**
 * Validates GitHub PR URL format
 * Expected: https://github.com/{org}/{repo}/pull/{number}
 */
function isValidGitHubPRUrl(url: string): boolean {
  const regex = new RegExp('^https://github\\.com/[^/\\s]+/[^/\\s]+/pull/\\d+$');
  return regex.test(url);
}

/**
 * Extracts PR number from GitHub PR URL
 */
function extractPRNumber(url: string): number | undefined {
  const match = url.match(/\/pull\/(\d+)$/);
  return match ? parseInt(match[1], 10) : undefined;
}
