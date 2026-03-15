import { AxiosError } from 'axios';

export class PMProviderClientError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly providerErrorCode: string | undefined,
    public readonly providerErrorBody: unknown,
  ) {
    super(`PM provider returned ${httpStatus}: ${providerErrorCode ?? 'CLIENT_ERROR'}`);
    this.name = 'PMProviderClientError';
    Object.setPrototypeOf(this, new.target.prototype);
  }

  static isRetryable(error: unknown): boolean {
    if (error instanceof PMProviderClientError) return false;

    if (error instanceof AxiosError) {
      const status = error.response?.status;
      if (!status) return true; // network error
      if (status === 429) return true; // rate limit
      if (status >= 500) return true; // server error
      if (status >= 400 && status < 500) return false; // 4xx client error
      return false; // 1xx/2xx/3xx — do not fall through to code check
    }

    const code = (error as { code?: string }).code;
    if (
      ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNABORTED', 'ECONNREFUSED'].includes(code ?? '')
    ) {
      return true;
    }

    return false;
  }
}
