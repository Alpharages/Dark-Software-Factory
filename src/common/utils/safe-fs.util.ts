import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';

/**
 * Safe File System Utilities
 *
 * Provides path-validated file operations that prevent path traversal attacks.
 * All operations verify the resolved path is within the allowed root directory.
 *
 * Story 2.16: Security lint warnings cleanup - replaces eslint-disable comments
 * with actual path validation.
 */

/**
 * Validates that a path is within the allowed root directory.
 * Prevents path traversal attacks (e.g., ../../etc/passwd)
 *
 * @param filePath - The path to validate
 * @param allowedRoot - The root directory that filePath must be within
 * @returns The resolved absolute path if valid
 * @throws Error if path is outside allowed root
 */
export function validatePath(filePath: string, allowedRoot: string): string {
  const resolvedPath = path.resolve(filePath);
  const resolvedRoot = path.resolve(allowedRoot);

  // Handle filesystem root specially (e.g., "/" on Unix, "C:\" on Windows)
  // When allowedRoot is the filesystem root, any absolute path is valid
  const isRootAllowed = resolvedRoot === path.parse(resolvedRoot).root;

  if (isRootAllowed) {
    // When root is filesystem root, just ensure path is absolute (already is after resolve)
    return resolvedPath;
  }

  // For non-root allowed directories, ensure path is within that directory
  if (!resolvedPath.startsWith(resolvedRoot + path.sep) && resolvedPath !== resolvedRoot) {
    throw new Error(`Path traversal detected: ${filePath} is outside allowed root ${allowedRoot}`);
  }

  return resolvedPath;
}

/**
 * Safe mkdir - creates directory only if within allowed root
 */
export async function safeMkdir(
  dirPath: string,
  allowedRoot: string,
  options?: fsSync.MakeDirectoryOptions,
): Promise<string | undefined> {
  const validatedPath = validatePath(dirPath, allowedRoot);
  return fs.mkdir(validatedPath, options);
}

/**
 * Safe readFile - reads file only if within allowed root
 */
export async function safeReadFile(
  filePath: string,
  allowedRoot: string,
  encoding?: BufferEncoding,
): Promise<string | Buffer> {
  const validatedPath = validatePath(filePath, allowedRoot);
  if (encoding) {
    return fs.readFile(validatedPath, encoding);
  }
  return fs.readFile(validatedPath);
}

/**
 * Safe readFile as string - reads file as UTF-8 string
 */
export async function safeReadFileString(filePath: string, allowedRoot: string): Promise<string> {
  const validatedPath = validatePath(filePath, allowedRoot);
  return fs.readFile(validatedPath, 'utf-8');
}

/**
 * Safe readFile as buffer - reads file as Buffer
 */
export async function safeReadFileBuffer(filePath: string, allowedRoot: string): Promise<Buffer> {
  const validatedPath = validatePath(filePath, allowedRoot);
  return fs.readFile(validatedPath);
}

/**
 * Safe writeFile - writes file only if within allowed root
 */
export async function safeWriteFile(
  filePath: string,
  allowedRoot: string,
  data: string | Buffer,
  encoding?: BufferEncoding,
): Promise<void> {
  const validatedPath = validatePath(filePath, allowedRoot);
  if (encoding) {
    return fs.writeFile(validatedPath, data, encoding);
  }
  return fs.writeFile(validatedPath, data);
}

/**
 * Safe unlink - deletes file only if within allowed root
 */
export async function safeUnlink(filePath: string, allowedRoot: string): Promise<void> {
  const validatedPath = validatePath(filePath, allowedRoot);
  return fs.unlink(validatedPath);
}

/**
 * Safe readdir - reads directory only if within allowed root
 */
export async function safeReaddir(
  dirPath: string,
  allowedRoot: string,
  options?: { withFileTypes: true },
): Promise<fsSync.Dirent[] | string[]> {
  const validatedPath = validatePath(dirPath, allowedRoot);
  if (options?.withFileTypes) {
    return fs.readdir(validatedPath, { withFileTypes: true });
  }
  return fs.readdir(validatedPath);
}

/**
 * Safe stat - gets file stats only if within allowed root
 */
export async function safeStat(filePath: string, allowedRoot: string): Promise<fsSync.Stats> {
  const validatedPath = validatePath(filePath, allowedRoot);
  return fs.stat(validatedPath);
}

/**
 * Safe rm - removes file/directory only if within allowed root
 */
export async function safeRm(
  filePath: string,
  allowedRoot: string,
  options?: fsSync.RmOptions,
): Promise<void> {
  const validatedPath = validatePath(filePath, allowedRoot);
  return fs.rm(validatedPath, options);
}

/**
 * Sanitizes a path component (filename or directory name) to prevent injection.
 * Removes path separators and special characters.
 *
 * @param component - The path component to sanitize
 * @returns Sanitized string safe for use in paths
 */
export function sanitizePathComponent(component: string): string {
  // Remove path separators and null bytes
  return component.replace(/[/\\]/g, '_').replace(/\0/g, '').replace(/\.\./g, '__');
}

/**
 * Constructs a safe path by joining components within an allowed root.
 * Each component is sanitized before joining.
 *
 * @param allowedRoot - The root directory
 * @param components - Path components to join (will be sanitized)
 * @returns Safe, validated absolute path
 */
export function buildSafePath(allowedRoot: string, ...components: string[]): string {
  const sanitized = components.map(sanitizePathComponent);
  const joined = path.join(allowedRoot, ...sanitized);
  return validatePath(joined, allowedRoot);
}
