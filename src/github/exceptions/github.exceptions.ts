import { HttpException, HttpStatus } from '@nestjs/common';

export class GitHubBaseException extends HttpException {
  constructor(
    message: string,
    status: HttpStatus,
    public readonly errorCode: string,
  ) {
    super({ message, errorCode }, status);
  }
}

export class GitHubAuthError extends GitHubBaseException {
  constructor(message: string = 'GitHub authentication failed') {
    super(message, HttpStatus.UNAUTHORIZED, 'GITHUB_AUTH_001');
  }
}

export class GitHubRateLimitError extends GitHubBaseException {
  constructor(
    public readonly resetTime: Date,
    message: string = 'GitHub rate limit exceeded',
  ) {
    super(message, HttpStatus.TOO_MANY_REQUESTS, 'GITHUB_RATE_002');
  }
}

export class GitHubResourceNotFoundError extends GitHubBaseException {
  constructor(resource: string) {
    super(`GitHub resource not found: ${resource}`, HttpStatus.NOT_FOUND, 'GITHUB_NOT_FOUND_003');
  }
}

export class GitHubNetworkError extends GitHubBaseException {
  constructor(message: string) {
    super(`GitHub network error: ${message}`, HttpStatus.BAD_GATEWAY, 'GITHUB_NETWORK_004');
  }
}
