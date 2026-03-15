import { PMProviderClientError } from './pm-provider-client.error';
import { AxiosError } from 'axios';

function makeAxiosError(status: number, data?: unknown): AxiosError {
  const error = new AxiosError('Request failed');
  error.response = {
    status,
    data: data ?? {},
    headers: {},
    config: {} as AxiosError['config'],
    statusText: String(status),
  } as AxiosError['response'];
  return error;
}

function makeNetworkError(code: string): AxiosError {
  const error = new AxiosError('Network error');
  error.code = code;
  return error;
}

describe('PMProviderClientError', () => {
  describe('Constructor', () => {
    it('T-E1: should set properties and message correctly', () => {
      const status = 400;
      const errorCode = 'SOME_ERROR';
      const errorBody = { detail: 'something went wrong' };
      const error = new PMProviderClientError(status, errorCode, errorBody);

      expect(error.httpStatus).toBe(status);
      expect(error.providerErrorCode).toBe(errorCode);
      expect(error.providerErrorBody).toBe(errorBody);
      expect(error.message).toBe(`PM provider returned ${status}: ${errorCode}`);
      expect(error.name).toBe('PMProviderClientError');
    });

    it('should use CLIENT_ERROR if errorCode is undefined', () => {
      const error = new PMProviderClientError(404, undefined, {});
      expect(error.message).toBe('PM provider returned 404: CLIENT_ERROR');
    });
  });

  describe('isRetryable', () => {
    it('T-E2: should return false for PMProviderClientError instance', () => {
      const error = new PMProviderClientError(400, 'BAD_REQUEST', {});
      expect(PMProviderClientError.isRetryable(error)).toBe(false);
    });

    it('T-E3: should return false for AxiosError with status 400', () => {
      const error = makeAxiosError(400);
      expect(PMProviderClientError.isRetryable(error)).toBe(false);
    });

    it('T-E4: should return false for AxiosError with status 403', () => {
      const error = makeAxiosError(403);
      expect(PMProviderClientError.isRetryable(error)).toBe(false);
    });

    it('T-E5: should return false for AxiosError with status 404', () => {
      const error = makeAxiosError(404);
      expect(PMProviderClientError.isRetryable(error)).toBe(false);
    });

    it('T-E6: should return false for AxiosError with status 422', () => {
      const error = makeAxiosError(422);
      expect(PMProviderClientError.isRetryable(error)).toBe(false);
    });

    it('T-E7: should return true for AxiosError with status 429', () => {
      const error = makeAxiosError(429);
      expect(PMProviderClientError.isRetryable(error)).toBe(true);
    });

    it('T-E8: should return true for AxiosError with status 500', () => {
      const error = makeAxiosError(500);
      expect(PMProviderClientError.isRetryable(error)).toBe(true);
    });

    it('T-E9: should return true for AxiosError with status 503', () => {
      const error = makeAxiosError(503);
      expect(PMProviderClientError.isRetryable(error)).toBe(true);
    });

    it('T-E10: should return true for AxiosError with no response (network error)', () => {
      const error = new AxiosError('Network error');
      expect(PMProviderClientError.isRetryable(error)).toBe(true);
    });

    it('T-E11: should return false for plain Error', () => {
      const error = new Error('Some error');
      expect(PMProviderClientError.isRetryable(error)).toBe(false);
    });

    it('T-E12: should return true for error with code ECONNRESET', () => {
      const error = makeNetworkError('ECONNRESET');
      expect(PMProviderClientError.isRetryable(error)).toBe(true);
    });

    it('T-E13: should return true for error with code ETIMEDOUT', () => {
      const error = makeNetworkError('ETIMEDOUT');
      expect(PMProviderClientError.isRetryable(error)).toBe(true);
    });

    it('T-E14: should return true for error with code ENOTFOUND', () => {
      const error = makeNetworkError('ENOTFOUND');
      expect(PMProviderClientError.isRetryable(error)).toBe(true);
    });

    it('should return true for error with code ECONNABORTED', () => {
      const error = makeNetworkError('ECONNABORTED');
      expect(PMProviderClientError.isRetryable(error)).toBe(true);
    });

    it('should return true for error with code ECONNREFUSED', () => {
      const error = makeNetworkError('ECONNREFUSED');
      expect(PMProviderClientError.isRetryable(error)).toBe(true);
    });
  });
});
