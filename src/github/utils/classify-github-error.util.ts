// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function classifyGitHubError(error: any): string {
  // HTTP status codes
  if (error.status === 401 || error.status === 403) return 'authentication';
  if (error.status === 429) return 'rate_limit';
  if (error.status === 400 || error.status === 422) return 'validation';
  if (error.status === 409) return 'conflict';

  const message = error.message || '';

  // E3: GitHub-specific error codes from Octokit
  if (message.includes('abuse')) return 'rate_limit'; // abuse -> rate_limit or 'abuse_limit' if desired, story list says 'rate_limit' or 'authentication'? No, Story says 'rate_limit'. Wait, 'abuse_limit' mentioned in Dev Notes template.
  // AC#1: `authentication`, `rate_limit`, `network`, `validation`, `conflict`, `timeout`, `unknown`
  // Dev Notes: `abuse_limit` in code example. I should stick to AC#1 values if possible.
  // Actually Dev Notes code says: `if (error.message?.includes('abuse')) return 'abuse_limit';`
  // But AC#1 lists only: `authentication`, `rate_limit`, `network`, `validation`, `conflict`, `timeout`, `unknown`.
  // I will map abuse to rate_limit to be safe, or just follow implementation if strict.
  // I will follow Dev Notes implementation but ensure return type matches story if types are strict.
  // The story doesn't define a type, just "error_type values".
  // I'll stick to AC#1 and map abuse to rate_limit.
  // Or maybe "abuse_limit" is implicitly allowed.
  // I'll map to 'rate_limit' for simplicity and compliance with AC#1 strictly.
  if (message.includes('abuse')) return 'rate_limit';

  if (message.includes('blocked')) return 'authentication'; // blocked user ~ auth/permission? Or unknown.
  // AC#1 doesn't have 'blocked'.

  // Network errors
  if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND')
    return 'network';

  if (message.includes('timeout')) return 'timeout';

  return 'unknown';
}
