import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parse } from 'csv-parse/sync';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Prisma } from '@/prisma/client';
import { PrismaService } from '@/database/prisma.service';
import { EncryptionService } from '@/common/encryption/encryption.service';
import {
  CREDENTIAL_KEYS,
  PROVIDERS,
  RUNTIMES,
  expectedRuntime,
  type Provider,
  type Runtime,
} from './constants';
import type { CreateAiAccountDto } from './dto/create-ai-account.dto';
import type { UpdateAiAccountDto } from './dto/update-ai-account.dto';

const REQUIRED_COLUMNS = [
  'label',
  'provider',
  'runtime',
  'credentials_json',
  'quota_config_json',
] as const;

/** Non-secret projection returned by every read path (AC1 — credentials never leave the boundary). */
export interface RedactedAiAccount {
  id: string;
  label: string;
  provider: string;
  runtime: string;
  enabled: boolean;
  quota_config: unknown;
  created_at: Date;
  updated_at: Date;
}

export interface ImportRowError {
  row: number; // 1-based data-row index (header excluded); references position, never content
  reason: string; // field/row-level reason only — NEVER contains a credential value or raw cell
}

export interface ImportSummary {
  imported: number;
  skipped: number;
  errors: ImportRowError[];
}

/**
 * Claude login-session state for one claude account, derived from its per-account config dir.
 * - `missing`  — never provisioned; the run WILL fail. Must run scripts/claude-account-login.sh.
 * - `expired`  — access token past expiry. Often auto-refreshes, so "needs attention", not dead.
 * - `expiring` — within the warning window; re-login soon to avoid a lapse.
 * - `active`   — valid, comfortably in date.
 * - `unknown`  — dir exists but no readable expiry (e.g. keychain-stored on macOS, or a format change).
 */
export type ClaudeSessionStatus = 'active' | 'expiring' | 'expired' | 'unknown' | 'missing';

export interface ClaudeSessionInfo {
  id: string;
  label: string;
  email: string | null;
  enabled: boolean;
  status: ClaudeSessionStatus;
  expiresAt: Date | null;
  lastLoginAt: Date | null;
}

/** Sessions expiring within this window are flagged `expiring` so an admin can re-login early. */
const SESSION_EXPIRY_WARN_MS = 24 * 60 * 60 * 1000;

/** Prisma `select` that structurally excludes the `credentials` column — redaction by construction. */
const REDACTED_SELECT = {
  id: true,
  label: true,
  provider: true,
  runtime: true,
  enabled: true,
  quota_config: true,
  created_at: true,
  updated_at: true,
} as const;

@Injectable()
export class AiAccountsService {
  private readonly logger = new Logger(AiAccountsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Import accounts from a CSV buffer. Parses, validates provider/runtime integrity + JSON
   * shape per row, encrypts credentials, and idempotently upserts by (provider, label).
   *
   * AC3: no row content ever reaches a log or an error message. Error reasons reference the
   * row index and field name only; the raw CSV and every credential stay in memory.
   */
  async importFromCsv(buffer: Buffer): Promise<ImportSummary> {
    let records: Record<string, string>[];
    try {
      records = parse(buffer, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        bom: true,
      });
    } catch {
      // csv-parse errors can embed the offending line — never surface err.message (AC3).
      throw new BadRequestException('CSV could not be parsed — malformed structure.');
    }

    const summary: ImportSummary = { imported: 0, skipped: 0, errors: [] };
    const seen = new Set<string>(); // (provider,label) keys already processed in THIS file

    for (const [i, record] of records.entries()) {
      const row = i + 1;
      try {
        const parsed = this.validateRow(record);
        // Within-file duplicate: the upsert would collapse it to one row anyway — skip it with a
        // redacted reason rather than double-counting it as imported (AC6 idempotency).
        // JSON-encode the pair so the key is collision-proof without a delimiter char (a raw
        // NUL was used here before, which flagged the whole file as binary and broke git diffs).
        const dedupKey = JSON.stringify([parsed.provider, parsed.label]);
        if (seen.has(dedupKey)) {
          summary.skipped++;
          summary.errors.push({
            row,
            reason: 'duplicate of an earlier row in this file (provider+label)',
          });
          continue;
        }
        seen.add(dedupKey);
        const ciphertext = this.encryption.encrypt(JSON.stringify(parsed.credentials));
        await this.prisma.aiAccount.upsert({
          where: { provider_label: { provider: parsed.provider, label: parsed.label } },
          update: {
            runtime: parsed.runtime,
            credentials: ciphertext,
            quota_config: parsed.quotaConfig,
          },
          create: {
            label: parsed.label,
            provider: parsed.provider,
            runtime: parsed.runtime,
            credentials: ciphertext,
            quota_config: parsed.quotaConfig,
          },
        });
        summary.imported++;
      } catch (err) {
        // Only a redacted, field-level reason is captured — never the record's values.
        summary.skipped++;
        summary.errors.push({ row, reason: this.redactReason(err) });
      }
    }

    // Counts/labels only — never row content (AC3).
    this.logger.log(
      `CSV import complete: ${summary.imported} imported, ${summary.skipped} skipped, ${summary.errors.length} row errors.`,
    );
    return summary;
  }

  /** List all accounts with credentials structurally excluded (AC1). */
  async list(): Promise<RedactedAiAccount[]> {
    return this.prisma.aiAccount.findMany({
      select: REDACTED_SELECT,
      orderBy: [{ provider: 'asc' }, { label: 'asc' }],
    });
  }

  /** Add a single account to the pool. Returns the redacted row. */
  async create(dto: CreateAiAccountDto): Promise<RedactedAiAccount> {
    const wantRuntime = expectedRuntime(dto.provider);
    if (wantRuntime !== dto.runtime) {
      throw new BadRequestException(
        `field "runtime" is inconsistent with "provider" (provider "${dto.provider}" requires runtime "${wantRuntime}")`,
      );
    }
    const credentials = this.assertAndProjectCredentials(dto.provider, dto.credentials);
    const ciphertext = this.encryption.encrypt(JSON.stringify(credentials));

    try {
      return await this.prisma.aiAccount.create({
        data: {
          label: dto.label,
          provider: dto.provider,
          runtime: dto.runtime,
          credentials: ciphertext,
          quota_config: (dto.quota_config ?? {}) as Prisma.InputJsonValue,
          enabled: dto.enabled ?? true,
        },
        select: REDACTED_SELECT,
      });
    } catch (err) {
      if ((err as { code?: string })?.code === 'P2002') {
        throw new BadRequestException(
          `An account with label "${dto.label}" already exists for provider "${dto.provider}".`,
        );
      }
      throw err;
    }
  }

  /** Edit an account — label, quota, credentials, and/or enabled. Returns the redacted row. */
  async update(id: string, dto: UpdateAiAccountDto): Promise<RedactedAiAccount> {
    const existing = await this.prisma.aiAccount.findUnique({
      where: { id },
      select: { id: true, provider: true },
    });
    if (!existing) {
      throw new NotFoundException(`AiAccount not found: ${id}`);
    }

    const data: Prisma.AiAccountUpdateInput = {};
    if (dto.label !== undefined) data.label = dto.label;
    if (dto.quota_config !== undefined)
      data.quota_config = dto.quota_config as Prisma.InputJsonValue;
    if (dto.enabled !== undefined) data.enabled = dto.enabled;
    if (dto.credentials !== undefined) {
      const credentials = this.assertAndProjectCredentials(
        existing.provider as Provider,
        dto.credentials,
      );
      data.credentials = this.encryption.encrypt(JSON.stringify(credentials));
    }

    return this.prisma.aiAccount.update({ where: { id }, data, select: REDACTED_SELECT });
  }

  /**
   * Remove an account from the pool. In-flight executions that selected this account are
   * unaffected — `Execution.selected_account_id` is `onDelete: SetNull`; usage rows cascade.
   */
  async remove(id: string): Promise<void> {
    const existing = await this.prisma.aiAccount.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException(`AiAccount not found: ${id}`);
    }
    await this.prisma.aiAccount.delete({ where: { id } });
  }

  /**
   * Internal-only seam for A5/A6 — decrypts and returns the account's credential payload for
   * in-process use. NEVER exposed over HTTP. Kept here so account selection + env injection can
   * layer on top without reshaping A4's model.
   */
  async getDecryptedCredentials(id: string): Promise<Record<string, unknown>> {
    const account = await this.prisma.aiAccount.findUnique({
      where: { id },
      select: { credentials: true },
    });
    if (!account) {
      throw new NotFoundException(`AiAccount not found: ${id}`);
    }
    return JSON.parse(this.encryption.decrypt(account.credentials));
  }

  /**
   * Report the Claude Code login-session state for every claude account by probing each
   * account's per-account config dir (`<claudeAccountsDir>/<id>/.credentials.json`) — the same
   * dir the runner points `CLAUDE_CONFIG_DIR` at, provisioned once via
   * `scripts/claude-account-login.sh <id>`. Powers the admin "Claude sessions" UI so operators
   * can spot missing/expiring logins and re-authenticate before a run fails.
   */
  async listClaudeSessions(): Promise<ClaudeSessionInfo[]> {
    const baseDir = this.claudeAccountsDir();
    const accounts = await this.prisma.aiAccount.findMany({
      where: { provider: 'claude' },
      select: { id: true, label: true, enabled: true, credentials: true },
      orderBy: [{ label: 'asc' }],
    });
    return Promise.all(
      accounts.map(async (a) => {
        const configDir = path.join(baseDir, a.id);
        const probe = await this.probeClaudeSession(configDir);
        return {
          id: a.id,
          label: a.label,
          // The stored email is a non-secret identifier (no password is kept) — surfaced here so
          // the admin UI can show which Anthropic account each session belongs to.
          email: this.readAccountEmail(a.credentials),
          enabled: a.enabled,
          ...probe,
        };
      }),
    );
  }

  /** Best-effort decrypt of a claude account's stored email. Never throws — returns null on failure. */
  private readAccountEmail(ciphertext: string): string | null {
    try {
      const parsed = JSON.parse(this.encryption.decrypt(ciphertext)) as { email?: unknown };
      return typeof parsed.email === 'string' ? parsed.email : null;
    } catch {
      return null;
    }
  }

  private claudeAccountsDir(): string {
    return (
      this.config.get<string>('openharness.claudeAccountsDir') ??
      path.join(os.homedir(), '.dsf', 'claude-accounts')
    );
  }

  private async probeClaudeSession(
    configDir: string,
  ): Promise<{ status: ClaudeSessionStatus; expiresAt: Date | null; lastLoginAt: Date | null }> {
    const credFile = path.join(configDir, '.credentials.json');
    let raw: string;
    let lastLoginAt: Date | null = null;
    try {
      // credFile derives from our own config base + a DB-issued account UUID — not user input.
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      lastLoginAt = (await fs.stat(credFile)).mtime;
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      raw = await fs.readFile(credFile, 'utf8');
    } catch {
      return { status: 'missing', expiresAt: null, lastLoginAt: null };
    }
    const expiresAt = this.readSessionExpiry(raw);
    if (expiresAt === null) {
      return { status: 'unknown', expiresAt: null, lastLoginAt };
    }
    const now = Date.now();
    const status: ClaudeSessionStatus =
      expiresAt.getTime() <= now
        ? 'expired'
        : expiresAt.getTime() <= now + SESSION_EXPIRY_WARN_MS
          ? 'expiring'
          : 'active';
    return { status, expiresAt, lastLoginAt };
  }

  /** Best-effort read of the OAuth expiry (epoch ms) from Claude Code's credentials file. */
  private readSessionExpiry(raw: string): Date | null {
    try {
      const parsed = JSON.parse(raw) as { claudeAiOauth?: { expiresAt?: unknown } };
      const expiresAt = parsed.claudeAiOauth?.expiresAt;
      return typeof expiresAt === 'number' && Number.isFinite(expiresAt)
        ? new Date(expiresAt)
        : null;
    } catch {
      return null;
    }
  }

  /**
   * Validate one CSV record. Throws a redacted, field-level error on any violation — the thrown
   * message references field names only, never the offending value.
   */
  private validateRow(record: Record<string, string>): {
    label: string;
    provider: Provider;
    runtime: Runtime;
    credentials: Record<string, unknown>;
    quotaConfig: Prisma.InputJsonValue;
  } {
    for (const col of REQUIRED_COLUMNS) {
      if (!(col in record)) {
        throw new BadRequestException(`missing required column "${col}"`);
      }
    }

    const label = (record.label ?? '').trim();
    if (!label) {
      throw new BadRequestException('field "label" is empty');
    }

    const provider = (record.provider ?? '').trim() as Provider;
    if (!PROVIDERS.includes(provider)) {
      throw new BadRequestException(`field "provider" must be one of ${PROVIDERS.join(', ')}`);
    }

    const runtime = (record.runtime ?? '').trim() as Runtime;
    if (!RUNTIMES.includes(runtime)) {
      throw new BadRequestException(`field "runtime" must be one of ${RUNTIMES.join(', ')}`);
    }

    const wantRuntime = expectedRuntime(provider);
    if (wantRuntime !== runtime) {
      throw new BadRequestException(
        `field "runtime" is inconsistent with "provider" (provider "${provider}" requires runtime "${wantRuntime}")`,
      );
    }

    const rawCredentials = this.parseJsonObject(record.credentials_json, 'credentials_json');
    const credentials = this.assertAndProjectCredentials(
      provider,
      rawCredentials,
      'credentials_json',
    );
    const quotaConfig = this.parseJsonObject(record.quota_config_json, 'quota_config_json');

    return {
      label,
      provider,
      runtime,
      credentials,
      quotaConfig: quotaConfig as Prisma.InputJsonValue,
    };
  }

  /**
   * Validate a provider-shaped credential payload and project it down to only the declared keys
   * (e.g. a legacy claude `password` is dropped so we never store a credential we no longer use).
   * Shared by CSV import and the JSON create/update paths (AC3: error references key names only).
   */
  private assertAndProjectCredentials(
    provider: Provider,
    raw: Record<string, unknown>,
    field = 'credentials',
  ): Record<string, string> {
    const credentials: Record<string, string> = {};
    // eslint-disable-next-line security/detect-object-injection -- provider is validated against PROVIDERS
    for (const key of CREDENTIAL_KEYS[provider]) {
      // eslint-disable-next-line security/detect-object-injection -- key is a trusted literal from CREDENTIAL_KEYS
      const value = raw[key];
      if (typeof value !== 'string' || value.trim() === '') {
        throw new BadRequestException(
          `field "${field}" is missing required key "${key}" for provider "${provider}"`,
        );
      }
      // eslint-disable-next-line security/detect-object-injection -- key is a trusted literal from CREDENTIAL_KEYS
      credentials[key] = value;
    }
    return credentials;
  }

  /** Parse a JSON-object cell. Error references the field name only — never the raw value (AC3). */
  private parseJsonObject(value: string | undefined, field: string): Record<string, unknown> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value ?? '');
    } catch {
      throw new BadRequestException(`field "${field}" is not valid JSON`);
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new BadRequestException(`field "${field}" must be a JSON object`);
    }
    return parsed as Record<string, unknown>;
  }

  /**
   * Coerce any thrown error into a leak-safe reason. Our own validation errors are pre-redacted
   * (field names only); anything else is collapsed to a generic message so no credential or raw
   * cell can escape via an unexpected error path (AC3).
   */
  private redactReason(err: unknown): string {
    if (err instanceof BadRequestException) {
      const response = err.getResponse();
      const message =
        typeof response === 'string' ? response : (response as { message?: string }).message;
      if (typeof message === 'string') return message;
    }
    return 'row rejected (invalid data)';
  }
}
