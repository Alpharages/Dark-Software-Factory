import { HttpException, HttpStatus } from '@nestjs/common';

export class InfrastructureException extends HttpException {
  constructor(message: string, cause?: unknown) {
    super(
      {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        error: 'Infrastructure Error',
        message,
        details: cause instanceof Error ? cause.message : cause,
      },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
    this.cause = cause;
  }
}
