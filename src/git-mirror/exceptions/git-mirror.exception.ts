import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Base exception for Git Mirror operations
 * Following pattern from src/github/exceptions/github.exceptions.ts
 */
export class GitMirrorException extends HttpException {
  constructor(
    message: string,
    status: HttpStatus,
    public readonly errorCode: string,
  ) {
    super({ message, errorCode }, status);
  }
}

/**
 * Exception for authentication failures during mirror operations
 * AC#4: Handle authentication properly with clear error messages
 */
export class MirrorAuthError extends GitMirrorException {
  constructor(repoUrl: string) {
    super(
      `Authentication failed for mirror: ${repoUrl}`,
      HttpStatus.UNAUTHORIZED,
      'GIT_MIRROR_AUTH_ERROR',
    );
  }
}

/**
 * Exception for network-related errors during mirror operations
 * AC#4: Handle network failures gracefully
 */
export class MirrorNetworkError extends GitMirrorException {
  constructor(repoUrl: string, originalError: string) {
    super(
      `Network error for mirror ${repoUrl}: ${originalError}`,
      HttpStatus.SERVICE_UNAVAILABLE,
      'GIT_MIRROR_NETWORK_ERROR',
    );
  }
}

/**
 * Exception for corrupted mirror detection
 * Handles cases where git fsck fails or repository is damaged
 */
export class MirrorCorruptedError extends GitMirrorException {
  constructor(mirrorPath: string) {
    super(
      `Mirror corrupted at ${mirrorPath}, will recreate`,
      HttpStatus.INTERNAL_SERVER_ERROR,
      'GIT_MIRROR_CORRUPTED_ERROR',
    );
  }
}

/**
 * Exception for disk space errors during mirror creation
 * AC#5: Handle disk space issues gracefully
 */
export class MirrorDiskSpaceError extends GitMirrorException {
  constructor(requiredBytes: number, availableBytes: number) {
    super(
      `Insufficient disk space for mirror: required ${requiredBytes} bytes, available ${availableBytes} bytes`,
      HttpStatus.INSUFFICIENT_STORAGE,
      'GIT_MIRROR_DISK_SPACE_ERROR',
    );
  }
}

/**
 * Exception for mirror lock timeout
 * Handles concurrent access scenarios
 */
export class MirrorLockTimeoutError extends GitMirrorException {
  constructor(mirrorPath: string, timeoutMs: number) {
    super(
      `Mirror lock timeout at ${mirrorPath} after ${timeoutMs}ms`,
      HttpStatus.CONFLICT,
      'GIT_MIRROR_LOCK_TIMEOUT_ERROR',
    );
  }
}
