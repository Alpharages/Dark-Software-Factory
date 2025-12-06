import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Base exception for commit-related errors
 */
export class CommitException extends HttpException {
  constructor(message: string, status: HttpStatus = HttpStatus.INTERNAL_SERVER_ERROR) {
    super(message, status);
    this.name = 'CommitException';
  }
}

/**
 * Thrown when commit creation fails
 * AC#5: Error Handling & Resilience
 */
export class CommitCreationException extends CommitException {
  constructor(message: string, cause?: Error) {
    super(message, HttpStatus.INTERNAL_SERVER_ERROR);
    this.name = 'CommitCreationException';
    if (cause) {
      this.stack = cause.stack;
    }
  }
}

/**
 * Thrown when push operation fails
 * AC#5: Error Handling & Resilience
 */
export class PushFailedException extends CommitException {
  constructor(message: string, cause?: Error) {
    super(message, HttpStatus.INTERNAL_SERVER_ERROR);
    this.name = 'PushFailedException';
    if (cause) {
      this.stack = cause.stack;
    }
  }
}

/**
 * Thrown when file validation fails
 * AC#1: Security - path traversal prevention
 */
export class FileValidationException extends CommitException {
  constructor(message: string) {
    super(message, HttpStatus.BAD_REQUEST);
    this.name = 'FileValidationException';
  }
}
