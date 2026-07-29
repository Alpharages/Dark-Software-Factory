import { Test, TestingModule } from '@nestjs/testing';
import { Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { PrismaService } from '@/database/prisma.service';
import { EncryptionService } from '@/common/encryption/encryption.service';
import { AiAccountsService } from './ai-accounts.service';

// 32-byte (64 hex char) key so the real EncryptionService constructs cleanly.
const TEST_KEY = 'a'.repeat(64);

const SECRET_EMAIL = 'topsecret@example.com';
const SECRET_PW = 'SUPER-SECRET-PW-9000';
const SECRET_TOKEN = 'sk-OPENAI-SECRET-TOKEN';

/** In-memory prisma stub with genuine (provider,label) upsert semantics for idempotency tests. */
function makePrismaStub() {
  const rows: any[] = [];
  let seq = 0;
  const redact = (r: any) => {
    const { credentials: _omit, ...rest } = r;
    return rest;
  };
  return {
    _rows: rows,
    aiAccount: {
      create: jest.fn(async ({ data }: any) => {
        const dup = rows.find((r) => r.provider === data.provider && r.label === data.label);
        if (dup) {
          const err: any = new Error('Unique constraint failed');
          err.code = 'P2002';
          throw err;
        }
        const row = { id: `id-${++seq}`, created_at: new Date(), updated_at: new Date(), ...data };
        rows.push(row);
        return redact(row);
      }),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const { provider, label } = where.provider_label;
        const existing = rows.find((r) => r.provider === provider && r.label === label);
        if (existing) {
          Object.assign(existing, update, { updated_at: new Date() });
          return existing;
        }
        const row = {
          id: `id-${++seq}`,
          created_at: new Date(),
          updated_at: new Date(),
          enabled: true,
          ...create,
        };
        rows.push(row);
        return row;
      }),
      // Honor `select.credentials` so session probing can read the encrypted blob; every other
      // caller selects the redacted projection and must not see credentials.
      findMany: jest.fn(async ({ select }: any = {}) =>
        rows.map((r) => (select?.credentials ? r : redact(r))),
      ),
      findUnique: jest.fn(async ({ where, select }: any) => {
        const row = rows.find((r) => r.id === where.id);
        if (!row) return null;
        if (select?.credentials && Object.keys(select).length === 1) {
          return { credentials: row.credentials };
        }
        return select?.id && Object.keys(select).length === 1 ? { id: row.id } : row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = rows.find((r) => r.id === where.id);
        Object.assign(row, data, { updated_at: new Date() });
        return redact(row);
      }),
      delete: jest.fn(async ({ where }: any) => {
        const index = rows.findIndex((r) => r.id === where.id);
        const [row] = rows.splice(index, 1);
        return redact(row);
      }),
    },
  };
}

function csv(...lines: string[]): Buffer {
  return Buffer.from(
    ['label,provider,runtime,credentials_json,quota_config_json', ...lines].join('\n'),
    'utf8',
  );
}

// A valid claude row whose credential JSON embeds commas + quotes (parser-correctness edge case).
const CLAUDE_ROW = `claude-1,claude,claude,"{""email"":""${SECRET_EMAIL}"",""password"":""${SECRET_PW}""}","{""weekly_budget"":1000,""five_hour_budget"":200}"`;
const OPENAI_ROW = `openai-1,openai,oh,"{""token"":""${SECRET_TOKEN}""}","{""weekly_budget"":2000}"`;

describe('AiAccountsService', () => {
  let service: AiAccountsService;
  let prisma: ReturnType<typeof makePrismaStub>;
  let encryption: EncryptionService;
  let claudeAccountsBase: string;

  beforeEach(async () => {
    prisma = makePrismaStub();
    encryption = new EncryptionService({
      get: () => TEST_KEY,
    } as unknown as ConfigService);
    claudeAccountsBase = await fs.mkdtemp(path.join(os.tmpdir(), 'dsf-claude-sessions-'));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiAccountsService,
        { provide: PrismaService, useValue: prisma },
        { provide: EncryptionService, useValue: encryption },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              key === 'openharness.claudeAccountsDir' ? claudeAccountsBase : undefined,
          },
        },
      ],
    }).compile();

    service = module.get(AiAccountsService);
  });

  afterEach(async () => {
    await fs.rm(claudeAccountsBase, { recursive: true, force: true });
  });

  describe('importFromCsv', () => {
    it('AC1: stores credentials only as iv:authTag:ciphertext that round-trips via decrypt', async () => {
      const summary = await service.importFromCsv(csv(CLAUDE_ROW));

      expect(summary).toEqual({ imported: 1, skipped: 0, errors: [] });
      const stored = prisma._rows[0].credentials as string;
      // Not plaintext.
      expect(stored).not.toContain(SECRET_PW);
      expect(stored).not.toContain(SECRET_EMAIL);
      // iv:authTag:ciphertext shape (three hex segments).
      expect(stored).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
      // Round-trips to the stored credential JSON — password is dropped (only declared keys persist).
      expect(JSON.parse(encryption.decrypt(stored))).toEqual({ email: SECRET_EMAIL });
      // quota_config stored as a parsed object for A5.
      expect(prisma._rows[0].quota_config).toEqual({ weekly_budget: 1000, five_hour_budget: 200 });
    });

    it('AC3: never logs or returns any credential value or raw cell', async () => {
      const logSpy = jest.spyOn(Logger.prototype, 'log');
      const warnSpy = jest.spyOn(Logger.prototype, 'warn');
      const errorSpy = jest.spyOn(Logger.prototype, 'error');

      // one valid + one invalid (mismatch) row, both carrying secrets
      const summary = await service.importFromCsv(
        csv(CLAUDE_ROW, `bad,claude,oh,"{""password"":""${SECRET_PW}""}","{}"`),
      );

      const allLogArgs = [...logSpy.mock.calls, ...warnSpy.mock.calls, ...errorSpy.mock.calls]
        .flat()
        .map((a) => JSON.stringify(a))
        .join(' ');
      for (const secret of [SECRET_EMAIL, SECRET_PW, SECRET_TOKEN]) {
        expect(allLogArgs).not.toContain(secret);
      }
      // Error reasons reference field/row only — never the value.
      const reasons = summary.errors.map((e) => e.reason).join(' ');
      expect(reasons).not.toContain(SECRET_PW);
      expect(summary.errors[0]).toMatchObject({ row: 2 });
      expect(summary.errors[0].reason).toMatch(/runtime|provider/);
    });

    it('AC6: rejects provider/runtime mismatch fail-loud, does not insert', async () => {
      const summary = await service.importFromCsv(
        csv(`x,claude,oh,"{""email"":""a"",""password"":""b""}","{}"`),
      );
      expect(summary.imported).toBe(0);
      expect(summary.skipped).toBe(1);
      expect(prisma._rows).toHaveLength(0);
    });

    it('AC6: rejects malformed credential JSON with a redacted reason', async () => {
      const summary = await service.importFromCsv(csv(`x,openai,oh,not-json,"{}"`));
      expect(summary.imported).toBe(0);
      expect(summary.errors[0].reason).toMatch(/credentials_json/);
    });

    it('AC6: re-importing the same CSV is idempotent (upsert by provider+label)', async () => {
      const buf = () => csv(CLAUDE_ROW, OPENAI_ROW);
      await service.importFromCsv(buf());
      const second = await service.importFromCsv(buf());

      expect(second.imported).toBe(2);
      expect(prisma._rows).toHaveLength(2); // no duplicates
    });

    it('supports both providers in one import', async () => {
      const summary = await service.importFromCsv(csv(CLAUDE_ROW, OPENAI_ROW));
      expect(summary.imported).toBe(2);
      expect(prisma._rows.map((r) => r.provider).sort()).toEqual(['claude', 'openai']);
    });

    it('edge: empty and header-only CSV import nothing', async () => {
      expect(await service.importFromCsv(Buffer.from('', 'utf8'))).toEqual({
        imported: 0,
        skipped: 0,
        errors: [],
      });
      expect(await service.importFromCsv(csv())).toMatchObject({ imported: 0, skipped: 0 });
    });

    it('edge: missing required column rejects every row', async () => {
      const buf = Buffer.from('label,provider,runtime\nx,claude,claude', 'utf8');
      const summary = await service.importFromCsv(buf);
      expect(summary.imported).toBe(0);
      expect(summary.errors[0].reason).toMatch(/missing required column/);
    });

    it('edge: duplicate (provider,label) within one file imports once, skips the rest', async () => {
      const summary = await service.importFromCsv(csv(CLAUDE_ROW, CLAUDE_ROW));
      expect(summary.imported).toBe(1);
      expect(summary.skipped).toBe(1);
      expect(prisma._rows).toHaveLength(1);
      expect(summary.errors[0]).toMatchObject({ row: 2 });
      expect(summary.errors[0].reason).toMatch(/duplicate/);
    });

    it('AC6: rejects credentials missing a provider-required key (redacted, key name only)', async () => {
      // claude row missing the required "email" key
      const summary = await service.importFromCsv(csv(`x,claude,claude,"{""foo"":""bar""}","{}"`));
      expect(summary.imported).toBe(0);
      expect(summary.skipped).toBe(1);
      expect(summary.errors[0].reason).toMatch(/missing required key "email"/);
    });

    it('drops non-declared credential keys (e.g. a legacy claude password is never stored)', async () => {
      // CLAUDE_ROW carries email + password; only email must survive to storage.
      const summary = await service.importFromCsv(csv(CLAUDE_ROW));
      expect(summary.imported).toBe(1);
      const stored = prisma._rows[0].credentials as string;
      expect(stored).not.toContain(SECRET_PW);
      expect(JSON.parse(encryption.decrypt(stored))).toEqual({ email: SECRET_EMAIL });
    });

    it('edge: mixed valid/invalid rows import partially with per-row errors', async () => {
      const summary = await service.importFromCsv(
        csv(CLAUDE_ROW, `bad,openai,claude,"{}","{}"`, OPENAI_ROW),
      );
      expect(summary.imported).toBe(2);
      expect(summary.skipped).toBe(1);
      expect(summary.errors[0].row).toBe(2);
    });
  });

  describe('list', () => {
    it('AC1: returns rows with no credentials field', async () => {
      await service.importFromCsv(csv(CLAUDE_ROW));
      const list = await service.list();
      expect(list[0]).not.toHaveProperty('credentials');
      expect(list[0]).toMatchObject({ label: 'claude-1', provider: 'claude', enabled: true });
    });
  });

  describe('create', () => {
    it('adds a single account and encrypts its credentials', async () => {
      const account = await service.create({
        label: 'claude-1',
        provider: 'claude',
        runtime: 'claude',
        credentials: { email: SECRET_EMAIL },
      });

      expect(account).not.toHaveProperty('credentials');
      expect(account).toMatchObject({ label: 'claude-1', provider: 'claude', enabled: true });
      const stored = prisma._rows[0].credentials as string;
      expect(stored).not.toContain(SECRET_EMAIL);
      expect(JSON.parse(encryption.decrypt(stored))).toEqual({ email: SECRET_EMAIL });
    });

    it('defaults enabled to true and quota_config to {}', async () => {
      const account = await service.create({
        label: 'openai-1',
        provider: 'openai',
        runtime: 'oh',
        credentials: { token: SECRET_TOKEN },
      });
      expect(account.enabled).toBe(true);
      expect(account.quota_config).toEqual({});
    });

    it('rejects a provider/runtime mismatch', async () => {
      await expect(
        service.create({
          label: 'x',
          provider: 'claude',
          runtime: 'oh',
          credentials: { email: SECRET_EMAIL },
        }),
      ).rejects.toThrow(/runtime/);
    });

    it('rejects credentials missing a provider-required key', async () => {
      await expect(
        service.create({
          label: 'x',
          provider: 'claude',
          runtime: 'claude',
          credentials: {},
        }),
      ).rejects.toThrow(/missing required key "email"/);
    });

    it('rejects a duplicate (provider,label) with a clean 400', async () => {
      await service.create({
        label: 'claude-1',
        provider: 'claude',
        runtime: 'claude',
        credentials: { email: SECRET_EMAIL },
      });
      await expect(
        service.create({
          label: 'claude-1',
          provider: 'claude',
          runtime: 'claude',
          credentials: { email: 'other@example.com' },
        }),
      ).rejects.toThrow(/already exists/);
    });
  });

  describe('update', () => {
    it('edits label, quota_config, and enabled', async () => {
      await service.importFromCsv(csv(CLAUDE_ROW));
      const id = prisma._rows[0].id;

      const updated = await service.update(id, {
        label: 'claude-1-renamed',
        quota_config: { weekly_budget: 5000 },
        enabled: false,
      });

      expect(updated).toMatchObject({
        label: 'claude-1-renamed',
        quota_config: { weekly_budget: 5000 },
        enabled: false,
      });
      expect(updated).not.toHaveProperty('credentials');
    });

    it('AC4: toggles enabled and persists', async () => {
      await service.importFromCsv(csv(CLAUDE_ROW));
      const id = prisma._rows[0].id;

      const disabled = await service.update(id, { enabled: false });
      expect(disabled.enabled).toBe(false);
      expect(disabled).not.toHaveProperty('credentials');

      const enabled = await service.update(id, { enabled: true });
      expect(enabled.enabled).toBe(true);
    });

    it('replaces credentials, re-encrypting under the account provider', async () => {
      await service.importFromCsv(csv(CLAUDE_ROW));
      const id = prisma._rows[0].id;

      await service.update(id, { credentials: { email: 'new@example.com' } });
      expect(await service.getDecryptedCredentials(id)).toEqual({ email: 'new@example.com' });
    });

    it('rejects replacement credentials missing a provider-required key', async () => {
      await service.importFromCsv(csv(CLAUDE_ROW));
      const id = prisma._rows[0].id;
      await expect(service.update(id, { credentials: {} })).rejects.toThrow(
        /missing required key "email"/,
      );
    });

    it('throws NotFound for an unknown id', async () => {
      await expect(service.update('nope', { enabled: false })).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('deletes the account', async () => {
      await service.importFromCsv(csv(CLAUDE_ROW));
      const id = prisma._rows[0].id;

      await service.remove(id);

      expect(prisma._rows).toHaveLength(0);
      await expect(service.getDecryptedCredentials(id)).rejects.toThrow(NotFoundException);
    });

    it('throws NotFound for an unknown id', async () => {
      await expect(service.remove('nope')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getDecryptedCredentials', () => {
    it('internal seam decrypts credentials for in-process use (A5/A6)', async () => {
      await service.importFromCsv(csv(OPENAI_ROW));
      const id = prisma._rows[0].id;
      expect(await service.getDecryptedCredentials(id)).toEqual({ token: SECRET_TOKEN });
    });

    it('throws NotFound for an unknown id', async () => {
      await expect(service.getDecryptedCredentials('nope')).rejects.toThrow(NotFoundException);
    });
  });

  describe('listClaudeSessions', () => {
    // Seed a claude account row with a known id (and real encrypted email) so we can build its
    // config dir deterministically and verify the email surfaces in the session view.
    function seedClaude(id: string, label = id, enabled = true) {
      prisma._rows.push({
        id,
        label,
        provider: 'claude',
        runtime: 'claude',
        enabled,
        credentials: encryption.encrypt(JSON.stringify({ email: `${id}@example.com` })),
        quota_config: {},
      });
    }

    async function writeCreds(id: string, body: unknown) {
      const dir = path.join(claudeAccountsBase, id);
      // Test-controlled path under a mkdtemp dir — not user input.
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      await fs.mkdir(dir, { recursive: true });
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      await fs.writeFile(path.join(dir, '.credentials.json'), JSON.stringify(body), 'utf8');
    }

    it('reports missing when no config dir has been provisioned, with the account email', async () => {
      seedClaude('acct-missing');
      const [session] = await service.listClaudeSessions();
      expect(session).toMatchObject({
        id: 'acct-missing',
        email: 'acct-missing@example.com',
        status: 'missing',
        expiresAt: null,
      });
    });

    it('classifies active / expiring / expired from the OAuth expiresAt', async () => {
      const now = Date.now();
      seedClaude('acct-active');
      seedClaude('acct-expiring');
      seedClaude('acct-expired');
      await writeCreds('acct-active', { claudeAiOauth: { expiresAt: now + 48 * 3600 * 1000 } });
      await writeCreds('acct-expiring', { claudeAiOauth: { expiresAt: now + 3600 * 1000 } });
      await writeCreds('acct-expired', { claudeAiOauth: { expiresAt: now - 3600 * 1000 } });

      const byId = Object.fromEntries((await service.listClaudeSessions()).map((s) => [s.id, s]));
      expect(byId['acct-active'].status).toBe('active');
      expect(byId['acct-expiring'].status).toBe('expiring');
      expect(byId['acct-expired'].status).toBe('expired');
      expect(byId['acct-active'].lastLoginAt?.getTime()).toBeGreaterThan(0);
    });

    it('reports unknown when the creds file has no readable expiry', async () => {
      seedClaude('acct-unknown');
      await writeCreds('acct-unknown', { somethingElse: true });
      const [session] = await service.listClaudeSessions();
      expect(session.status).toBe('unknown');
      expect(session.lastLoginAt?.getTime()).toBeGreaterThan(0);
    });
  });
});
