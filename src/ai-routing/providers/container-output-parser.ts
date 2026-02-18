/**
 * Container Output Parser
 *
 * Parses raw container output from Claude CLI (and other AI providers)
 * into structured, human-readable activity events for the PM dashboard.
 *
 * The parser detects:
 * - Package management (npm, pnpm, yarn install/audit)
 * - Git operations (clone, checkout, commit, push)
 * - Build steps (compile, transpile, bundle)
 * - Test execution (jest, mocha, vitest)
 * - Linting & formatting (eslint, prettier)
 * - AI thinking / planning / coding
 * - File operations (read, write, create, delete)
 * - Docker / container lifecycle
 * - Errors and warnings
 */

export type ActivityCategory =
  | 'SETUP'
  | 'DEPENDENCY'
  | 'GIT'
  | 'AI_THINKING'
  | 'AI_CODING'
  | 'BUILD'
  | 'TEST'
  | 'LINT'
  | 'FILE_OP'
  | 'DEPLOY'
  | 'ERROR'
  | 'SYSTEM';

export interface ContainerActivity {
  /** Human-readable activity label */
  activity: string;
  /** Optional extra detail (e.g. package count, file name) */
  detail?: string;
  /** Full raw content for expandable detail view (e.g. full error output, tool result body) */
  rawContent?: string;
  /** Category for grouping & color-coding */
  category: ActivityCategory;
  /** Icon hint for the UI (lucide icon name) */
  icon: string;
  /** Suggested progress percentage (0-100), undefined to keep current */
  suggestedPercent?: number;
}

interface PatternRule {
  /** Regex patterns to match (case-insensitive) */
  patterns: RegExp[];
  /** Factory to build the activity from the matched output */
  build: (match: RegExpMatchArray | null, raw: string) => ContainerActivity;
  /** Priority (lower = matched first). Default 100 */
  priority?: number;
}

/**
 * Stateful parser that tracks the execution stage and deduplicates
 * repeated activities (e.g. many npm install progress lines).
 */
export class ContainerOutputParser {
  private lastCategory: ActivityCategory | null = null;
  private lastActivity: string | null = null;
  private lastEmitTime = 0;
  private readonly minEmitIntervalMs: number;

  constructor(options?: { minEmitIntervalMs?: number }) {
    // Default: only emit a new activity every 2 seconds for the same category
    this.minEmitIntervalMs = options?.minEmitIntervalMs ?? 2000;
  }

  /**
   * Parse a raw output chunk and return a structured activity, or null
   * if the chunk is noise / duplicate of the current activity.
   */
  parse(raw: string): ContainerActivity | null {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.length < 3) return null;

    const lower = trimmed.toLowerCase();

    for (const rule of RULES) {
      for (const pattern of rule.patterns) {
        const match = lower.match(pattern);
        if (match) {
          const activity = rule.build(match, trimmed);

          // Dedup: skip if same category+activity within interval
          if (this.shouldSkip(activity)) return null;

          this.lastCategory = activity.category;
          this.lastActivity = activity.activity;
          this.lastEmitTime = Date.now();
          return activity;
        }
      }
    }

    return null; // Unrecognized output — don't emit noise
  }

  /** Reset parser state (for new execution) */
  reset(): void {
    this.lastCategory = null;
    this.lastActivity = null;
    this.lastEmitTime = 0;
  }

  private shouldSkip(activity: ContainerActivity): boolean {
    const now = Date.now();
    // Always emit if category changed
    if (activity.category !== this.lastCategory) return false;
    // Always emit if activity label changed
    if (activity.activity !== this.lastActivity) return false;
    // Same category + activity: throttle
    return now - this.lastEmitTime < this.minEmitIntervalMs;
  }
}

// ─────────────────────────────────────────────────────────────────
// Pattern Rules (ordered by priority — first match wins)
// ─────────────────────────────────────────────────────────────────

const act = (a: ContainerActivity): ContainerActivity => a;

const RULES: PatternRule[] = [
  // ── Errors (highest priority) ──────────────────────────────
  {
    priority: 10,
    patterns: [
      /\b(error|err!|fatal|crash|exception|segfault|panic)\b/,
      /\bexit code [1-9]\d*/,
      /\bfailed with/,
      /\bcommand failed/,
      /\bejs|errno\b/,
    ],
    build: (_match: RegExpMatchArray | null, raw: string) =>
      act({
        activity: 'Error encountered',
        detail: raw.substring(0, 120),
        rawContent: raw,
        category: 'ERROR',
        icon: 'alert-triangle',
      }),
  },

  // ── Package Management ─────────────────────────────────────
  {
    priority: 20,
    patterns: [/npm\s+(install|i|ci)\b/, /npm\s+warn/, /added\s+\d+\s+packages?/],
    build: (_match: RegExpMatchArray | null, raw: string) => {
      const pkgCount = raw.match(/added\s+(\d+)\s+packages?/i);
      return act({
        activity: 'Installing npm packages',
        detail: pkgCount ? `${pkgCount[1]} packages` : undefined,
        category: 'DEPENDENCY',
        icon: 'package',
        suggestedPercent: 15,
      });
    },
  },
  {
    priority: 20,
    patterns: [/pnpm\s+(install|i|add)\b/, /pnpm\s+lockfile/],
    build: () =>
      act({
        activity: 'Installing packages (pnpm)',
        category: 'DEPENDENCY',
        icon: 'package',
        suggestedPercent: 15,
      }),
  },
  {
    priority: 20,
    patterns: [/yarn\s+(install|add)\b/],
    build: () =>
      act({
        activity: 'Installing packages (yarn)',
        category: 'DEPENDENCY',
        icon: 'package',
        suggestedPercent: 15,
      }),
  },
  {
    priority: 21,
    patterns: [/npm\s+audit/, /\d+\s+vulnerabilit/],
    build: (_match: RegExpMatchArray | null, raw: string) => {
      const vulns = raw.match(/(\d+)\s+vulnerabilit/i);
      return act({
        activity: 'Running security audit',
        detail: vulns ? `${vulns[1]} vulnerabilities found` : undefined,
        category: 'DEPENDENCY',
        icon: 'shield',
      });
    },
  },
  {
    priority: 22,
    patterns: [
      /resolving\s+(packages|dependencies)/,
      /\bfetching\b.*packages/,
      /\bdownloading\b.*\bpackage/,
    ],
    build: () =>
      act({
        activity: 'Resolving dependencies',
        category: 'DEPENDENCY',
        icon: 'package-search',
        suggestedPercent: 12,
      }),
  },

  // ── Git Operations ─────────────────────────────────────────
  {
    priority: 30,
    patterns: [/git\s+clone\b/, /\bcloning\b.*into/],
    build: (_match: RegExpMatchArray | null, raw: string) => {
      const repo = raw.match(/(?:clone|cloning)\s+(?:into\s+)?['"]*([^\s'"]+)/i);
      return act({
        activity: 'Cloning repository',
        detail: repo ? repo[1] : undefined,
        category: 'GIT',
        icon: 'git-branch',
        suggestedPercent: 10,
      });
    },
  },
  {
    priority: 30,
    patterns: [/git\s+checkout\b/, /\bswitching\b.*branch/],
    build: (_match: RegExpMatchArray | null, raw: string) => {
      const branch = raw.match(/checkout\s+(?:-b\s+)?(\S+)/i);
      return act({
        activity: 'Switching branch',
        detail: branch ? branch[1] : undefined,
        category: 'GIT',
        icon: 'git-branch',
      });
    },
  },
  {
    priority: 30,
    patterns: [/git\s+commit\b/],
    build: () =>
      act({
        activity: 'Committing changes',
        category: 'GIT',
        icon: 'git-commit-horizontal',
        suggestedPercent: 85,
      }),
  },
  {
    priority: 30,
    patterns: [/git\s+push\b/],
    build: () =>
      act({
        activity: 'Pushing to remote',
        category: 'GIT',
        icon: 'upload',
        suggestedPercent: 90,
      }),
  },
  {
    priority: 30,
    patterns: [/git\s+pull\b/, /git\s+fetch\b/],
    build: () =>
      act({
        activity: 'Fetching latest changes',
        category: 'GIT',
        icon: 'download',
      }),
  },

  // ── AI Thinking / Planning ─────────────────────────────────
  {
    priority: 40,
    patterns: [
      /\b(thinking|planning|analyzing|reasoning|considering)\b/,
      /\breading\s+files?\b/,
      /\bunderstanding\b.*(?:code|context|project)/,
      /\blet me\b.*(?:think|analyze|review|understand)/,
    ],
    build: () =>
      act({
        activity: 'AI is analyzing & planning',
        category: 'AI_THINKING',
        icon: 'brain',
        suggestedPercent: 30,
      }),
  },

  // ── AI Writing Code ────────────────────────────────────────
  {
    priority: 41,
    patterns: [
      /\b(writing|editing|creating|modifying|updating)\b.*\b(file|code|component|module|function)\b/,
      /\bwrote\s+\d+\s+(?:files?|lines?)\b/,
      /\bcreated?\s+(?:new\s+)?file/,
    ],
    build: (_match: RegExpMatchArray | null, raw: string) => {
      const fileMatch = raw.match(
        /(?:writing|editing|creating|modifying)\s+(?:to\s+)?['"]*([^\s'"]+\.\w+)/i,
      );
      return act({
        activity: 'AI is writing code',
        detail: fileMatch ? fileMatch[1] : undefined,
        category: 'AI_CODING',
        icon: 'code',
        suggestedPercent: 55,
      });
    },
  },

  // ── Build / Compile ────────────────────────────────────────
  {
    priority: 50,
    patterns: [
      /\b(compiling|transpiling|bundling|building)\b/,
      /\btsc\b.*\bcompil/,
      /\bwebpack\b/,
      /\bvite\b.*\bbuild/,
      /\brollup\b/,
      /\bnext\s+build\b/,
      /\bprisma\s+generate\b/,
    ],
    build: (_match: RegExpMatchArray | null, raw: string) => {
      const tool = raw.match(/\b(tsc|webpack|vite|rollup|esbuild|prisma|next)\b/i);
      return act({
        activity: 'Building project',
        detail: tool ? `Using ${tool[1]}` : undefined,
        category: 'BUILD',
        icon: 'hammer',
        suggestedPercent: 65,
      });
    },
  },

  // ── Tests ──────────────────────────────────────────────────
  {
    priority: 50,
    patterns: [
      /\b(running|executing)\b.*\btests?\b/,
      /\bjest\b/,
      /\bvitest\b/,
      /\bmocha\b/,
      /\btest suites?\b.*\b(?:passed|failed)\b/,
      /tests?\s+passed/,
      /\bspec\b.*\b(?:pass|fail)\b/,
    ],
    build: (_match: RegExpMatchArray | null, raw: string) => {
      const results = raw.match(/(\d+)\s+(?:tests?\s+)?passed.*?(\d+)\s+failed/i);
      return act({
        activity: 'Running tests',
        detail: results ? `${results[1]} passed, ${results[2]} failed` : undefined,
        category: 'TEST',
        icon: 'test-tube-2',
        suggestedPercent: 75,
      });
    },
  },

  // ── Linting / Formatting ───────────────────────────────────
  {
    priority: 50,
    patterns: [
      /\b(eslint|prettier|biome|stylelint)\b/,
      /\blinting\b/,
      /\bformatting\b.*\bfiles?\b/,
    ],
    build: (_match: RegExpMatchArray | null, raw: string) => {
      const tool = raw.match(/\b(eslint|prettier|biome|stylelint)\b/i);
      return act({
        activity: 'Linting & formatting',
        detail: tool ? `Running ${tool[1]}` : undefined,
        category: 'LINT',
        icon: 'check-circle',
        suggestedPercent: 70,
      });
    },
  },

  // ── File Operations ────────────────────────────────────────
  {
    priority: 60,
    patterns: [
      /\breadfile\b|\bwritefile\b/,
      /\b(?:read|wrote|created|deleted|moved|renamed)\s+(?:file\s+)?['"]*\S+\.\w+/,
    ],
    build: (_match: RegExpMatchArray | null, raw: string) => {
      const fileMatch = raw.match(
        /(?:read|wrote|created|deleted|moved|renamed)\s+(?:file\s+)?['"]*(\S+\.\w+)/i,
      );
      return act({
        activity: 'File operation',
        detail: fileMatch ? fileMatch[1] : undefined,
        category: 'FILE_OP',
        icon: 'file-edit',
      });
    },
  },

  // ── Deploy / Docker ────────────────────────────────────────
  {
    priority: 70,
    patterns: [
      /\bdeploying\b/,
      /\bdocker\s+(?:build|push|pull)\b/,
      /\bcontainer\s+(?:started|stopped|running)\b/,
    ],
    build: () =>
      act({
        activity: 'Deploying',
        category: 'DEPLOY',
        icon: 'rocket',
        suggestedPercent: 90,
      }),
  },

  // ── System / Setup ─────────────────────────────────────────
  {
    priority: 80,
    patterns: [
      /\bworkspace\s+(?:ready|setup|initialized)\b/,
      /\benvironment\s+(?:ready|configured)\b/,
      /\bcontainer\b.*\bready\b/,
      /\bstarting\b.*\bexecution\b/,
    ],
    build: () =>
      act({
        activity: 'Setting up workspace',
        category: 'SETUP',
        icon: 'settings',
        suggestedPercent: 5,
      }),
  },

  // ── Verification / Running Commands ────────────────────────
  {
    priority: 85,
    patterns: [/\bverifying\b/, /\bvalidating\b/, /\bchecking\b.*\b(?:types?|syntax|output)\b/],
    build: () =>
      act({
        activity: 'Running verification',
        category: 'TEST',
        icon: 'shield-check',
        suggestedPercent: 80,
      }),
  },
].sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
