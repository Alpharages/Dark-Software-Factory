import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import type { AiAccount, Prisma } from '@/prisma/client';
import { PrismaService } from '@/database/prisma.service';
import { NoEligibleAccountError } from './errors/no-eligible-account.error';

export type AiProvider = 'claude' | 'openai';
export type AiRuntime = 'claude' | 'oh';

export interface SelectAccountRequest {
  provider: AiProvider;
  runtime: AiRuntime;
  model: string;
}

export interface RecordAccountUsage {
  tokens?: number;
  requests?: number;
  at?: Date;
}

export interface AiAccountClock {
  now(): Date;
}

export const AI_ACCOUNT_CLOCK = Symbol('AI_ACCOUNT_CLOCK');

type WindowKind = 'rolling_5h' | 'weekly' | 'provider_generic';
type QuotaConfig = Record<string, unknown>;
type UsageTotals = Partial<Record<WindowKind, { tokens: number; requests: number }>>;

interface WindowBudget {
  kind: WindowKind;
  tokenBudget?: number;
  requestBudget?: number;
  windowStart?: Date;
  windowEnd?: Date;
}

const DEFAULT_CLOCK: AiAccountClock = { now: () => new Date() };
const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class AiAccountSelectorService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(AI_ACCOUNT_CLOCK) private readonly clock: AiAccountClock = DEFAULT_CLOCK,
  ) {}

  async selectAccount(req: SelectAccountRequest): Promise<AiAccount> {
    const now = this.clock.now();
    const accounts = await this.prisma.aiAccount.findMany({
      where: { provider: req.provider, runtime: req.runtime, enabled: true },
      orderBy: [{ id: 'asc' }],
    });
    const usableAccounts = accounts.filter((account) => !this.isFailing(account.quota_config));
    const usage = await this.loadUsage(
      usableAccounts.map((account) => account.id),
      now,
    );
    const ranked = usableAccounts
      .map((account) => ({
        account,
        score: this.score(account, usage.get(account.id) ?? {}, now),
      }))
      .filter((entry): entry is { account: AiAccount; score: number } => entry.score !== null)
      .sort((a, b) => a.score - b.score || a.account.id.localeCompare(b.account.id));

    if (!ranked[0]) {
      throw new NoEligibleAccountError(req.provider, req.runtime);
    }
    return ranked[0].account;
  }

  async recordUsage(accountId: string, usage: RecordAccountUsage): Promise<void> {
    const account = await this.prisma.aiAccount.findUnique({ where: { id: accountId } });
    if (!account) {
      throw new NotFoundException(`AiAccount ${accountId} not found`);
    }

    const at = usage.at ?? this.clock.now();
    const tokens = usage.tokens ?? 0;
    const requests = usage.requests ?? 1;
    if (!Number.isFinite(tokens) || tokens < 0 || !Number.isFinite(requests) || requests < 0) {
      throw new BadRequestException(
        `Invalid usage for account ${accountId}: tokens=${tokens}, requests=${requests}`,
      );
    }
    const windows = this.windowsFor(account, at);

    await Promise.all(
      windows.map((window) =>
        this.prisma.aiAccountUsage.upsert({
          where: {
            account_id_window_kind_window_start: {
              account_id: accountId,
              window_kind: window.kind,
              window_start: window.windowStart ?? at,
            },
          },
          update: {
            tokens_used: { increment: tokens },
            requests: { increment: requests },
            window_end: window.windowEnd ?? at,
          },
          create: {
            account_id: accountId,
            window_kind: window.kind,
            window_start: window.windowStart ?? at,
            window_end: window.windowEnd ?? at,
            tokens_used: tokens,
            requests,
          },
        }),
      ),
    );
  }

  private async loadUsage(accountIds: string[], now: Date): Promise<Map<string, UsageTotals>> {
    if (accountIds.length === 0) {
      return new Map();
    }
    const rows = await this.prisma.aiAccountUsage.findMany({
      where: {
        account_id: { in: accountIds },
        window_start: { lte: now },
        window_end: { gt: now },
      },
    });
    const byAccount = new Map<string, UsageTotals>();
    for (const row of rows) {
      const totals = byAccount.get(row.account_id) ?? {};
      const kind = row.window_kind as WindowKind;
      // eslint-disable-next-line security/detect-object-injection
      const total = totals[kind] ?? { tokens: 0, requests: 0 };
      total.tokens += row.tokens_used;
      total.requests += row.requests;
      // eslint-disable-next-line security/detect-object-injection
      totals[kind] = total;
      byAccount.set(row.account_id, totals);
    }
    return byAccount;
  }

  private score(account: AiAccount, usage: UsageTotals, now: Date): number | null {
    const windows = this.windowsFor(account, now);

    let score = 0;
    for (const window of windows) {
      if (window.tokenBudget === undefined && window.requestBudget === undefined) {
        // No resolvable budget key for a required window — treat as misconfigured and
        // exclude, rather than silently granting unlimited (and unmetered) access.
        return null;
      }
      const totals = usage[window.kind] ?? { tokens: 0, requests: 0 };
      const tokenRatio = this.ratio(totals.tokens, window.tokenBudget);
      const requestRatio = this.ratio(totals.requests, window.requestBudget);
      if (tokenRatio >= 1 || requestRatio >= 1) {
        return null;
      }
      score = Math.max(score, tokenRatio, requestRatio);
    }
    return score;
  }

  private windowsFor(account: AiAccount, now: Date): WindowBudget[] {
    const config = this.config(account.quota_config);
    if (account.provider === 'claude') {
      // ponytail: rolling_5h buckets to the minute (not the raw millisecond) so
      // concurrent usage within the same minute increments one row instead of
      // creating a new one per call. Row growth is still unbounded over time —
      // add a pruning job once ai_account_usage volume actually matters.
      const rollingStart = this.bucketStart(now);
      const weekStart = this.weekStart(now, config);
      return [
        {
          kind: 'rolling_5h',
          tokenBudget: this.number(config, 'five_hour_budget', 'five_hour_token_budget'),
          requestBudget: this.number(config, 'five_hour_requests', 'five_hour_request_budget'),
          windowStart: rollingStart,
          windowEnd: new Date(rollingStart.getTime() + FIVE_HOURS_MS),
        },
        {
          kind: 'weekly',
          tokenBudget: this.number(config, 'weekly_budget', 'weekly_token_budget'),
          requestBudget: this.number(config, 'weekly_requests', 'weekly_request_budget'),
          windowStart: weekStart,
          windowEnd: new Date(weekStart.getTime() + WEEK_MS),
        },
      ];
    }

    const windowStart = this.weekStart(now, config);
    return [
      {
        kind: 'provider_generic',
        tokenBudget: this.number(config, 'provider_generic_budget', 'weekly_budget'),
        requestBudget: this.number(config, 'provider_generic_requests', 'weekly_requests'),
        windowStart,
        windowEnd: new Date(windowStart.getTime() + WEEK_MS),
      },
    ];
  }

  private bucketStart(date: Date): Date {
    const truncated = new Date(date);
    truncated.setUTCSeconds(0, 0);
    return truncated;
  }

  private config(value: Prisma.JsonValue): QuotaConfig {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  private number(config: QuotaConfig, ...keys: string[]): number | undefined {
    for (const key of keys) {
      // eslint-disable-next-line security/detect-object-injection
      const value = config[key];
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        return value;
      }
    }
    return undefined;
  }

  private ratio(used: number, budget?: number): number {
    return budget ? used / budget : 0;
  }

  private weekStart(now: Date, config: QuotaConfig): Date {
    const weekStartsOn = this.weekStartsOn(config);
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const diff = (start.getUTCDay() - weekStartsOn + 7) % 7;
    start.setUTCDate(start.getUTCDate() - diff);
    return start;
  }

  // Dedicated lookup (not `number()`) because `0` (Sunday) is a valid, distinct
  // value from "unset" — `number()`'s `value > 0` guard exists for budgets, where
  // 0 is meaningless, and would otherwise silently discard a Sunday-start config.
  private weekStartsOn(config: QuotaConfig): number {
    const value = config['week_starts_on'];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return 1;
    }
    const day = Math.trunc(value) % 7;
    return day < 0 ? day + 7 : day;
  }

  private isFailing(configValue: Prisma.JsonValue): boolean {
    const config = this.config(configValue);
    return config.failing === true || config.status === 'failing';
  }
}
