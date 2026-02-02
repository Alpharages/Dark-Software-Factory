/**
 * Mirror Information Interface
 * Story 23.1: Local Git Mirror Service
 */

export interface MirrorInfo {
  /** Repository owner (e.g., 'alpharages') */
  owner: string;

  /** Repository name (e.g., 'Dark Software Factory') */
  repo: string;

  /** Full path to the bare mirror on disk */
  mirrorPath: string;

  /** Size of mirror in bytes */
  sizeBytes: number;

  /** Last time the mirror was updated from remote */
  lastUpdated: Date;

  /** Last time the mirror was used for a clone */
  lastUsed: Date;

  /** Number of times this mirror has been used for cloning */
  cloneCount: number;
}

/**
 * Result of a mirror clone operation
 */
export interface MirrorCloneResult {
  /** Path to the created workspace */
  workspacePath: string;

  /** Source of the clone (mirror or direct) */
  source: 'mirror' | 'direct';

  /** Time taken for clone operation in milliseconds */
  durationMs: number;
}

/**
 * Options for mirror-based clone operations
 */
export interface MirrorCloneOptions {
  /** Execution ID for correlation */
  executionId: string;

  /** Repository URL to clone */
  repositoryUrl: string;

  /** Target workspace path */
  targetPath: string;

  /** Git branch to checkout */
  branch?: string;

  /** Depth for shallow clone (default: 1) */
  depth?: number;
}
