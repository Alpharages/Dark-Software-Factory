/**
 * Branch Name Utilities
 *
 * Implements branch naming convention: `ai/{ticket_id}-{slugified-title}`
 * Adheres to Git ref naming constraints and AC#1 requirements
 */

const MAX_BRANCH_LENGTH = 63; // Git ref limit
const BRANCH_NAME_REGEX = /^ai\/[a-z0-9]+(-[a-z0-9]+)*$/;

export interface BranchNameOptions {
  ticketId: string;
  title: string;
  timestamp?: number; // Optional timestamp suffix for conflict resolution
}

/**
 * Generates a branch name following the convention: ai/{ticket_id}-{slugified-title}
 *
 * AC#1: Branch Naming Convention
 * - Format: ai/{ticket_id}-{slugified-title}
 * - Lowercase, kebab-case only
 * - Maximum 63 characters
 * - Validation: Must match regex ^ai/[a-z0-9]+(-[a-z0-9]+)*$
 */
export function generateBranchName(options: BranchNameOptions): string {
  const { ticketId, title, timestamp } = options;

  // Slugify: lowercase, replace non-alphanumeric with hyphens
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // Replace non-alphanumeric with hyphens
    .replace(/^-+|-+$/g, '') // Remove leading/trailing hyphens
    .replace(/-+/g, '-'); // Replace consecutive hyphens with single

  // Construct base branch name
  let branchName = `ai/${ticketId.toLowerCase()}-${slug}`;

  // Add timestamp suffix if provided (for conflict resolution)
  if (timestamp) {
    branchName += `-${timestamp}`;
  }

  // Truncate to max length if necessary
  if (branchName.length > MAX_BRANCH_LENGTH) {
    // Preserve the prefix and ticket ID, truncate the slug
    const prefix = `ai/${ticketId.toLowerCase()}-`;
    const suffix = timestamp ? `-${timestamp}` : '';
    const availableLength = MAX_BRANCH_LENGTH - prefix.length - suffix.length;

    const truncatedSlug = slug.slice(0, availableLength).replace(/-+$/, '');
    branchName = `${prefix}${truncatedSlug}${suffix}`;
  }

  return branchName;
}

/**
 * Validates a branch name against the required format
 *
 * AC#1: Validation requirements
 * - Must match regex ^ai/[a-z0-9]+(-[a-z0-9]+)*$
 * - No consecutive hyphens
 * - No leading/trailing hyphens within segments
 * - No invalid characters
 */
export function validateBranchName(branchName: string): {
  valid: boolean;
  error?: string;
} {
  // Check maximum length
  if (branchName.length > MAX_BRANCH_LENGTH) {
    return {
      valid: false,
      error: `Branch name exceeds maximum length of ${MAX_BRANCH_LENGTH} characters`,
    };
  }

  // Check regex pattern
  if (!BRANCH_NAME_REGEX.test(branchName)) {
    return {
      valid: false,
      error: `Branch name does not match required pattern: ${BRANCH_NAME_REGEX}`,
    };
  }

  // Check for consecutive hyphens (already covered by regex, but explicit check)
  if (branchName.includes('--')) {
    return {
      valid: false,
      error: 'Branch name contains consecutive hyphens',
    };
  }

  return { valid: true };
}

/**
 * Generates unique branch name with timestamp suffix for conflict resolution
 *
 * AC#3: If execution is new and branch exists → Generate unique name with timestamp
 */
export function generateUniqueBranchName(ticketId: string, title: string): string {
  const timestamp = Math.floor(Date.now() / 1000); // Unix timestamp
  return generateBranchName({ ticketId, title, timestamp });
}
