import { NoEligibleAccountError } from './errors/no-eligible-account.error';
import { AiAccountClock, AiAccountSelectorService } from './account-selector.service';
import { PrismaService } from '@/database/prisma.service';

type Account = {
  id: string;
  label: string;
  provider: string;
  runtime: string;
  credentials: string;
  quota_config: Record<string, unknown>;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
};

type Usage = {
  id: string;
  account_id: string;
  window_kind: string;
  window_start: Date;
  window_end: Date;
  tokens_used: number;
  requests: number;
  updated_at: Date;
};

function makePrismaStub(accounts: Account[]) {
  const usage: Usage[] = [];
  return {
    _usage: usage,
    aiAccount: {
      findMany: jest.fn(async ({ where }: any) =>
        accounts.filter(
          (account) =>
            account.provider === where.provider &&
            account.runtime === where.runtime &&
            account.enabled === where.enabled,
        ),
      ),
      findUnique: jest.fn(
        async ({ where }: any) => accounts.find((account) => account.id === where.id) ?? null,
      ),
      update: jest.fn(async ({ where, data }: any) => {
        const row = accounts.find((account) => account.id === where.id);
        if (row) Object.assign(row, data);
        return row;
      }),
    },
    aiAccountUsage: {
      findMany: jest.fn(async ({ where }: any) =>
        usage.filter(
          (row) =>
            where.account_id.in.includes(row.account_id) &&
            row.window_start <= where.window_start.lte &&
            row.window_end > where.window_end.gt,
        ),
      ),
      upsert: jest.fn(async ({ where, update, create }: any) => {
        const key = where.account_id_window_kind_window_start;
        const row = usage.find(
          (item) =>
            item.account_id === key.account_id &&
            item.window_kind === key.window_kind &&
            item.window_start.getTime() === key.window_start.getTime(),
        );
        if (row) {
          row.tokens_used += update.tokens_used.increment;
          row.requests += update.requests.increment;
          row.window_end = update.window_end;
          row.updated_at = new Date();
          return row;
        }
        const created = { id: `usage-${usage.length + 1}`, updated_at: new Date(), ...create };
        usage.push(created);
        return created;
      }),
    },
  };
}

function account(id: string, overrides: Partial<Account> = {}): Account {
  return {
    id,
    label: id,
    provider: 'claude',
    runtime: 'claude',
    credentials: 'encrypted',
    quota_config: { five_hour_budget: 100, weekly_budget: 1000 },
    enabled: true,
    created_at: new Date('2026-07-01T00:00:00Z'),
    updated_at: new Date('2026-07-01T00:00:00Z'),
    ...overrides,
  };
}

describe('AiAccountSelectorService', () => {
  const now = new Date('2026-07-01T12:00:00Z');
  const clock: AiAccountClock = { now: () => now };

  function service(accounts: Account[]) {
    const prisma = makePrismaStub(accounts);
    return {
      prisma,
      selector: new AiAccountSelectorService(prisma as unknown as PrismaService, clock),
    };
  }

  it('AC1: spreads selections by choosing the least-consumed eligible account', async () => {
    const { selector } = service([account('a'), account('b'), account('c')]);
    const picks: Record<string, number> = {};

    for (let i = 0; i < 30; i++) {
      const picked = await selector.selectAccount({
        provider: 'claude',
        runtime: 'claude',
        model: 'sonnet',
      });
      picks[picked.id] = (picks[picked.id] ?? 0) + 1;
      await selector.recordUsage(picked.id, { tokens: 1, at: now });
    }

    expect(Object.values(picks).sort()).toEqual([10, 10, 10]);
  });

  it('AC2: skips a Claude account exhausted in its 5h window', async () => {
    const { selector } = service([account('full'), account('ok')]);
    await selector.recordUsage('full', { tokens: 100, at: now });

    await expect(
      selector.selectAccount({ provider: 'claude', runtime: 'claude', model: 'opus' }),
    ).resolves.toMatchObject({ id: 'ok' });
  });

  it('AC5: excludes a Claude account with 5h headroom but weekly budget exhausted', async () => {
    const { selector } = service([
      account('near-weekly', { quota_config: { five_hour_budget: 100000, weekly_budget: 50 } }),
      account('ok'),
    ]);
    await selector.recordUsage('near-weekly', { tokens: 50, at: now });

    await expect(
      selector.selectAccount({ provider: 'claude', runtime: 'claude', model: 'sonnet' }),
    ).resolves.toMatchObject({ id: 'ok' });
  });

  it('excludes an account with no resolvable budget key instead of treating it as unlimited', async () => {
    const { selector } = service([
      account('misconfigured', { quota_config: { five_hr_budget: 100 } }), // typo'd key
      account('ok'),
    ]);

    await expect(
      selector.selectAccount({ provider: 'claude', runtime: 'claude', model: 'sonnet' }),
    ).resolves.toMatchObject({ id: 'ok' });
  });

  it('honors week_starts_on: 0 (Sunday) instead of silently defaulting to Monday', async () => {
    // `now` (2026-07-01, Wednesday) week-starts on Sunday 2026-06-28 when week_starts_on: 0
    // is honored, vs. Monday 2026-06-29 under the old (buggy) default.
    const { selector } = service([
      account('sunday-week', {
        quota_config: { five_hour_budget: 100000, weekly_budget: 100, week_starts_on: 0 },
      }),
    ]);
    await selector.recordUsage('sunday-week', {
      tokens: 100,
      at: new Date('2026-06-28T12:00:00Z'),
    });

    await expect(
      selector.selectAccount({ provider: 'claude', runtime: 'claude', model: 'sonnet' }),
    ).rejects.toThrow(NoEligibleAccountError);
  });

  it('AC3: skips disabled and failing accounts', async () => {
    const { selector } = service([
      account('disabled', { enabled: false }),
      account('failing', {
        quota_config: { five_hour_budget: 100, weekly_budget: 1000, failing: true },
      }),
      account('ok'),
    ]);

    await expect(
      selector.selectAccount({ provider: 'claude', runtime: 'claude', model: 'sonnet' }),
    ).resolves.toMatchObject({ id: 'ok' });
  });

  it('AC4: matches provider and runtime exactly', async () => {
    const { selector } = service([
      account('claude'),
      account('openai', {
        provider: 'openai',
        runtime: 'oh',
        quota_config: { provider_generic_budget: 100 },
      }),
    ]);

    await expect(
      selector.selectAccount({ provider: 'openai', runtime: 'oh', model: 'gpt-5.4' }),
    ).resolves.toMatchObject({ id: 'openai' });
  });

  it('AC6: throws a typed error when the matching pool is dry', async () => {
    const { selector } = service([account('full')]);
    await selector.recordUsage('full', { tokens: 100, at: now });

    await expect(
      selector.selectAccount({ provider: 'claude', runtime: 'claude', model: 'opus' }),
    ).rejects.toThrow(NoEligibleAccountError);
  });

  it('AC7: rolling 5h usage ages out while weekly usage still counts', async () => {
    const { selector } = service([account('old'), account('fresh')]);
    await selector.recordUsage('old', { tokens: 100, at: new Date('2026-07-01T06:00:00Z') });
    await selector.recordUsage('fresh', { tokens: 10, at: now });

    await expect(
      selector.selectAccount({ provider: 'claude', runtime: 'claude', model: 'sonnet' }),
    ).resolves.toMatchObject({ id: 'fresh' });
  });

  it('quarantine excludes the account until the cooldown lapses, then readmits it', async () => {
    const prisma = makePrismaStub([account('limited'), account('ok')]);
    const selector = new AiAccountSelectorService(prisma as unknown as PrismaService, clock);
    await selector.quarantine('limited', 60 * 60 * 1000);

    // During cooldown: skipped even though it has full budget headroom.
    await expect(
      selector.selectAccount({ provider: 'claude', runtime: 'claude', model: 'sonnet' }),
    ).resolves.toMatchObject({ id: 'ok' });

    // Same pool 61 minutes later: cooldown lapsed. Give 'ok' real usage so
    // 'limited' can only win by being back in the pool.
    const later = new AiAccountSelectorService(prisma as unknown as PrismaService, {
      now: () => new Date(now.getTime() + 61 * 60 * 1000),
    });
    await later.recordUsage('ok', { tokens: 50 });
    await expect(
      later.selectAccount({ provider: 'claude', runtime: 'claude', model: 'sonnet' }),
    ).resolves.toMatchObject({ id: 'limited' });
  });

  it('quarantine rejects an unknown account id with NotFoundException', async () => {
    const { selector } = service([account('ok')]);

    await expect(selector.quarantine('missing', 1000)).rejects.toThrow(
      'AiAccount missing not found',
    );
  });

  it('recordUsage rejects an unknown account id with NotFoundException', async () => {
    const { selector } = service([account('ok')]);

    await expect(selector.recordUsage('missing', { tokens: 1, at: now })).rejects.toThrow(
      'AiAccount missing not found',
    );
  });

  it('recordUsage rejects negative token/request counts', async () => {
    const { selector } = service([account('ok')]);

    await expect(selector.recordUsage('ok', { tokens: -1, at: now })).rejects.toThrow(
      'Invalid usage for account ok',
    );
  });
});
