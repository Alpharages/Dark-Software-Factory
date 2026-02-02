/**
 * Mirror Metadata Interface
 * Story 23.1: Local Git Mirror Service
 *
 * Used for tracking mirror state in .metadata/mirrors.json
 */

export interface MirrorMetadata {
  /** Repository owner */
  owner: string;

  /** Repository name */
  repo: string;

  /** Full path to the bare mirror */
  mirrorPath: string;

  /** Size of mirror in bytes */
  sizeBytes: number;

  /** Last time the mirror was updated from remote */
  lastUpdated: string; // ISO date string

  /** Last time the mirror was used for cloning */
  lastUsed: string; // ISO date string

  /** Number of successful clones from this mirror */
  cloneCount: number;

  /** Number of times updates were fetched */
  updateCount: number;

  /** Original repository URL */
  repositoryUrl: string;

  /** Time of mirror creation */
  createdAt: string; // ISO date string
}

/**
 * Root metadata file structure
 */
export interface MirrorsMetadataFile {
  /** Version of metadata schema */
  version: string;

  /** Last time metadata was updated */
  lastUpdated: string;

  /** Map of repository keys (owner/repo) to metadata */
  mirrors: Record<string, MirrorMetadata>;
}

/**
 * LRU eviction candidate
 */
export interface MirrorEvictionCandidate {
  /** Repository owner */
  owner: string;

  /** Repository name */
  repo: string;

  /** Mirror path */
  mirrorPath: string;

  /** Size in bytes */
  sizeBytes: number;

  /** Last usage timestamp */
  lastUsed: Date;

  /** Clone count (lower = better candidate for eviction) */
  cloneCount: number;
}
