import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import { Prisma } from '@/prisma/client';
import { PrismaService } from '@/database/prisma.service';
import { EncryptionService } from '@/common/encryption/encryption.service';

/** Provider/runtime vocabulary — must match A3's SkillModelMap exactly so A5/A6 can join. */
const PROVIDERS = ['claude', 'openai'] as const;
const RUNTIMES = ['oh', 'claude'] as const;
type Provider = (typeof PROVIDERS)[number];
type Runtime = (typeof RUNTIMES)[number];

/** claude↔claude, openai↔oh — the only valid pairings. */
const expectedRuntime = (provider: Provider): Runtime => (provider === 'claude' ? 'claude' : 'oh');

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

    for (const [i, record] of records.entries()) {
      const row = i + 1;
      try {
        const parsed = this.validateRow(record);
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

  /** Enable/disable an account (AC4). Returns the redacted row. */
  async setEnabled(id: string, enabled: boolean): Promise<RedactedAiAccount> {
    const existing = await this.prisma.aiAccount.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException(`AiAccount not found: ${id}`);
    }
    return this.prisma.aiAccount.update({
      where: { id },
      data: { enabled },
      select: REDACTED_SELECT,
    });
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

    const credentials = this.parseJsonObject(record.credentials_json, 'credentials_json');
    const quotaConfig = this.parseJsonObject(record.quota_config_json, 'quota_config_json');

    return {
      label,
      provider,
      runtime,
      credentials,
      quotaConfig: quotaConfig as Prisma.InputJsonValue,
    };
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
