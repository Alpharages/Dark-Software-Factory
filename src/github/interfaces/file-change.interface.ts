/**
 * File Change Interface
 * Represents a file operation in code_output
 * AC#1: AI-Generated Code Collection
 */

export interface FileChange {
  path: string;
  operation: FileOperation;
  content: string;
  encoding: FileEncoding;
}

export type FileOperation = 'create' | 'modify' | 'delete';
export type FileEncoding = 'utf-8' | 'base64';

/**
 * Parsed code output structure from execution
 */
export interface CodeOutput {
  files_changed: FileChange[];
}

/**
 * GitHub blob creation result
 */
export interface BlobCreationResult {
  path: string;
  sha: string;
  size: number;
}

/**
 * GitHub tree entry for commit
 */
export interface TreeEntry {
  path: string;
  mode: '100644' | '100755' | '040000'; // Regular file, executable, directory
  type: 'blob' | 'tree' | 'commit';
  sha: string;
}
