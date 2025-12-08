import { classifyGitHubError } from './classify-github-error.util';

describe('classifyGitHubError', () => {
  it('should return "authentication" for 401/403 errors', () => {
    expect(classifyGitHubError({ status: 401 })).toBe('authentication');
    expect(classifyGitHubError({ status: 403 })).toBe('authentication');
  });

  it('should return "rate_limit" for 429 errors', () => {
    expect(classifyGitHubError({ status: 429 })).toBe('rate_limit');
  });

  it('should return "validation" for 400/422 errors', () => {
    expect(classifyGitHubError({ status: 400 })).toBe('validation');
    expect(classifyGitHubError({ status: 422 })).toBe('validation');
  });

  it('should return "conflict" for 409 errors', () => {
    expect(classifyGitHubError({ status: 409 })).toBe('conflict');
  });

  it('should return "rate_limit" for "abuse" mechanism messages', () => {
    expect(
      classifyGitHubError({ message: 'You have triggered an abuse detection mechanism' }),
    ).toBe('rate_limit');
  });

  it('should return "authentication" for "blocked" messages', () => {
    expect(classifyGitHubError({ message: 'Repository access blocked' })).toBe('authentication');
  });

  it('should return "network" for network connection codes', () => {
    expect(classifyGitHubError({ code: 'ECONNREFUSED' })).toBe('network');
    expect(classifyGitHubError({ code: 'ETIMEDOUT' })).toBe('network');
    expect(classifyGitHubError({ code: 'ENOTFOUND' })).toBe('network');
  });

  it('should return "timeout" for timeout messages', () => {
    expect(classifyGitHubError({ message: 'Request timeout' })).toBe('timeout');
  });

  it('should return "unknown" for generic errors', () => {
    expect(classifyGitHubError({ message: 'Random error' })).toBe('unknown');
    expect(classifyGitHubError({})).toBe('unknown');
  });
});
