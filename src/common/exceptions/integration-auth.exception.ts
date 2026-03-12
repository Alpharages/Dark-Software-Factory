import { HttpException, HttpStatus } from '@nestjs/common';

export class IntegrationAuthException extends HttpException {
  constructor(integrationId: string, cause?: unknown) {
    super(
      {
        status: HttpStatus.UNAUTHORIZED,
        error: 'Integration Auth Failed',
        message: `Token refresh failed for integration '${integrationId}'`,
        details: cause instanceof Error ? cause.message : cause,
      },
      HttpStatus.UNAUTHORIZED,
      { cause },
    );
  }
}
