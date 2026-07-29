/** Provider/runtime vocabulary — must match A3's SkillModelMap exactly so A5/A6 can join. */
export const PROVIDERS = ['claude', 'openai'] as const;
export const RUNTIMES = ['oh', 'claude'] as const;
export type Provider = (typeof PROVIDERS)[number];
export type Runtime = (typeof RUNTIMES)[number];

/** claude↔claude, openai↔oh — the only valid pairings. */
export const expectedRuntime = (provider: Provider): Runtime =>
  provider === 'claude' ? 'claude' : 'oh';

/**
 * Required credential keys per provider — validated present + non-empty (key names only, never
 * values). Only these keys are persisted; anything else in the payload is dropped. Claude no
 * longer stores a password (auth is the per-account CLAUDE_CONFIG_DIR browser session, not a
 * headless login); `email` is kept purely as a human identifier so the admin "Claude sessions"
 * view can show which account a session belongs to.
 */
export const CREDENTIAL_KEYS: Record<Provider, readonly string[]> = {
  claude: ['email'],
  openai: ['token'],
};
