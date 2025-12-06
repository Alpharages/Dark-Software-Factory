import { FileChange, TreeEntry } from '../interfaces/file-change.interface';

/**
 * File Tree Utility
 * AC#1: File path validation and tree building
 * AC#3: Git tree creation
 *
 * Security: Prevents path traversal attacks
 */

/**
 * Maximum file size: 100 MB (GitHub limit)
 */
export const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;

/**
 * Allowed directory prefixes for file paths
 * Security: Restrict files to specific directories
 */
const ALLOWED_PREFIXES = [
  'src/',
  'test/',
  'tests/',
  'docs/',
  'scripts/',
  'config/',
  'lib/',
  'spec/',
];

/**
 * Validates file path for security
 * Prevents path traversal attacks
 */
export function validateFilePath(path: string): { valid: boolean; error?: string } {
  // Reject paths with directory traversal patterns
  if (path.includes('..') || path.includes('~')) {
    return { valid: false, error: 'Path contains directory traversal pattern (..)' };
  }

  // Must be relative path within repository
  if (path.startsWith('/') || path.includes(':')) {
    return { valid: false, error: 'Path must be relative (no leading / or :)' };
  }

  // Check if path starts with allowed prefix
  const hasAllowedPrefix = ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix));
  if (!hasAllowedPrefix) {
    return {
      valid: false,
      error: `Path must start with one of: ${ALLOWED_PREFIXES.join(', ')}`,
    };
  }

  // Path is valid
  return { valid: true };
}

/**
 * Validates file size against GitHub limit
 */
export function validateFileSize(sizeBytes: number): { valid: boolean; error?: string } {
  if (sizeBytes > MAX_FILE_SIZE_BYTES) {
    return {
      valid: false,
      error: `File size ${sizeBytes} bytes exceeds GitHub limit of ${MAX_FILE_SIZE_BYTES} bytes (100 MB)`,
    };
  }

  return { valid: true };
}

/**
 * Encodes file content to base64
 * GitHub API requires base64 encoding for blobs
 */
export function encodeToBase64(content: string, encoding: 'utf-8' | 'base64'): string {
  if (encoding === 'base64') {
    // Already base64 encoded
    return content;
  }

  // UTF-8 to base64
  return Buffer.from(content, 'utf-8').toString('base64');
}

/**
 * Determines file mode based on path and content
 * - 100644: Regular file
 * - 100755: Executable file
 * - 040000: Directory (not used for blobs)
 */
export function determineFileMode(path: string): '100644' | '100755' {
  // Check if file is likely executable
  const executableExtensions = ['.sh', '.bash', '.zsh', '.py', '.rb', '.pl'];
  const isExecutable = executableExtensions.some((ext) => path.endsWith(ext));

  return isExecutable ? '100755' : '100644';
}

/**
 * Builds tree entries from file changes
 */
export function buildTreeEntries(
  fileChanges: FileChange[],
  blobShas: Map<string, string>,
): TreeEntry[] {
  const entries: TreeEntry[] = [];

  for (const fileChange of fileChanges) {
    if (fileChange.operation === 'delete') {
      // Deleted files are not included in the tree
      // They are implicitly removed by not including them
      continue;
    }

    const blobSha = blobShas.get(fileChange.path);
    if (!blobSha) {
      throw new Error(`Blob SHA not found for file: ${fileChange.path}`);
    }

    entries.push({
      path: fileChange.path,
      mode: determineFileMode(fileChange.path),
      type: 'blob',
      sha: blobSha,
    });
  }

  return entries;
}

/**
 * Extracts file type from path for metrics
 */
export function getFileType(path: string): string {
  const extension = path.split('.').pop();
  return extension || 'unknown';
}

/**
 * Calculates total size of files
 */
export function calculateTotalSize(files: FileChange[]): number {
  return files.reduce((total, file) => {
    const sizeBytes = Buffer.from(
      file.content,
      file.encoding === 'base64' ? 'base64' : 'utf-8',
    ).length;
    return total + sizeBytes;
  }, 0);
}

/**
 * Validates all file paths in collection
 */
export function validateAllFilePaths(files: FileChange[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const file of files) {
    const validation = validateFilePath(file.path);
    if (!validation.valid) {
      errors.push(`${file.path}: ${validation.error}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validates all file sizes in collection
 */
export function validateAllFileSizes(files: FileChange[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const file of files) {
    const sizeBytes = Buffer.from(
      file.content,
      file.encoding === 'base64' ? 'base64' : 'utf-8',
    ).length;
    const validation = validateFileSize(sizeBytes);

    if (!validation.valid) {
      errors.push(`${file.path}: ${validation.error}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
