import { HttpException, HttpStatus } from '@nestjs/common';

export class UnsupportedProviderException extends HttpException {
  constructor(provider: string) {
    super(
      {
        status: HttpStatus.BAD_REQUEST,
        error: 'Unsupported Provider',
        message: `PM provider '${provider}' is not supported by PMProviderFactory`,
      },
      HttpStatus.BAD_REQUEST,
    );
  }
}
