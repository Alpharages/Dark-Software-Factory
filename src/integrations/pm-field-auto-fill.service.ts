import { Injectable, Logger } from '@nestjs/common';
import { ProjectIntegration } from '@prisma/client';
import { PMProviderFactory } from './providers/pm-provider.factory';
import { SentryService } from '@/common/sentry/sentry.service';
import { SubscriptionCompletionService } from '@/common/ai/subscription-completion.service';
import {
  NormalizedField,
  NormalizedFieldType,
  FieldValue,
} from '@/integrations/providers/dto/normalized-field.dto';

export interface ExecutionContext {
  executionDurationMinutes?: number; // computed: (completed_at - started_at) / 60000 — undefined if either timestamp is null
  deployedAt?: Date | null; // Deployment.deployed_at
  prUrl?: string | null; // GitHubPush.pr_url
  branchName?: string | null; // GitHubPush.branch_name
}

export interface FactualFillResult {
  filledFields: Array<{ field: NormalizedField; value: FieldValue; source: string }>;
  remainingFields: NormalizedField[]; // fields with no matching factual pattern OR context value absent
  fillFailed?: boolean; // true only if a setFieldValue() call threw
}

export interface InferenceContext {
  ticketTitle?: string | null;
  ticketDescription?: string | null;
  executionDurationMinutes?: number;
  retryCount?: number;
  filesChangedCount?: number;
}

export interface InferredFillResult {
  filledFields: Array<{ field: NormalizedField; value: FieldValue; source: 'ai_inferred' }>;
  manualFields: NormalizedField[]; // Fields that require user input (Inference failed or field marked 'USER')
  inferFailed?: boolean; // True if API timeout, key missing, or parsing error
}

@Injectable()
export class PMFieldAutoFillService {
  private readonly logger = new Logger(PMFieldAutoFillService.name);

  constructor(
    private readonly providerFactory: PMProviderFactory,
    private readonly sentry: SentryService,
    private readonly subscription: SubscriptionCompletionService,
  ) {}

  /**
   * AC1: fillFactualFields logic.
   * Automatically populates factual fields from execution context.
   */
  async fillFactualFields(
    integration: ProjectIntegration,
    taskId: string,
    missingFields: NormalizedField[],
    executionContext: ExecutionContext,
    correlationId: string,
  ): Promise<FactualFillResult> {
    // AC11: Empty missingFields fast-path
    if (missingFields.length === 0) {
      return { filledFields: [], remainingFields: [] };
    }

    const filledFields: Array<{ field: NormalizedField; value: FieldValue; source: string }> = [];
    const remainingFields: NormalizedField[] = [];
    let fillFailed = false;

    try {
      // Step 1: Resolve provider
      const provider = await this.providerFactory.getProvider(integration);

      // Step 2-3: Match and fill fields sequentially (AC9)
      for (const field of missingFields) {
        const match = this.matchField(field, executionContext, correlationId);

        if (!match) {
          remainingFields.push(field);
          continue;
        }

        try {
          // AC4-AC7: Set field value via provider
          await provider.setFieldValue(taskId, field.id, match.value);
          filledFields.push({ field, value: match.value, source: match.source });
        } catch (error) {
          // AC10: partial-fail on setFieldValue error
          this.logger.warn(
            `[${correlationId}] CS2-2: setFieldValue failed for field ${field.id} (${field.name}): ${(error as Error).message} — adding to remainingFields`,
          );
          this.sentry.captureException(error as Error);
          remainingFields.push(field);
          fillFailed = true;
        }
      }

      // AC1: Debug log
      this.logger.debug(
        `[${correlationId}] CS2-2: factual fill for task ${taskId}: ${missingFields.length} missing fields, ${filledFields.length} filled, ${remainingFields.length} remaining`,
      );

      return {
        filledFields,
        remainingFields,
        fillFailed: fillFailed || undefined,
      };
    } catch (error) {
      // Fail-open: if provider cannot be fetched, all fields remain
      this.logger.error(
        `[${correlationId}] CS2-2: factual fill failed for task ${taskId}: ${(error as Error).message}`,
      );
      this.sentry.captureException(error as Error);
      return {
        filledFields: [],
        remainingFields: missingFields,
        fillFailed: true,
      };
    }
  }

  /**
   * CS2-3: fillInferredFields logic.
   * Uses AI (Claude) to infer values for estimatable fields.
   */
  async fillInferredFields(
    integration: ProjectIntegration,
    taskId: string,
    remainingFields: NormalizedField[],
    inferenceContext: InferenceContext,
    correlationId: string,
  ): Promise<InferredFillResult> {
    if (remainingFields.length === 0) {
      return { filledFields: [], manualFields: [] };
    }

    const filledFields: InferredFillResult['filledFields'] = [];
    const manualFields: NormalizedField[] = [];
    let inferFailed = false;

    // Filter estimatable vs manual fields
    const estimatableFields = remainingFields.filter((f) => {
      if (f.type === NormalizedFieldType.USER) {
        this.logger.debug(
          `[${correlationId}] CS2-3: field "${f.name}" is USER type — skipping (handled by CS1-5)`,
        );
        manualFields.push(f);
        return false;
      }
      return true;
    });

    if (estimatableFields.length === 0) {
      return { filledFields: [], manualFields };
    }

    // AC3: Fail-open if the Claude subscription CLI is unavailable
    if (!(await this.subscription.isAvailable())) {
      this.logger.warn(
        `[${correlationId}] CS2-3: AI inference skipped (claude CLI unavailable) — marking ${estimatableFields.length} fields as manual`,
      );
      return {
        filledFields: [],
        manualFields: [...manualFields, ...estimatableFields],
        inferFailed: true,
      };
    }

    try {
      this.logger.debug(
        `[${correlationId}] CS2-3: inferred fill for task ${taskId}: attempting AI inference for ${estimatableFields.length} fields`,
      );

      const prompt = this.buildInferencePrompt(estimatableFields, inferenceContext);

      // AC10: 10s timeout enforced by the subscription helper itself.
      let responseText: string;
      try {
        responseText = await this.subscription.complete(prompt, {
          system:
            'You are a project management assistant. Respond ONLY with a valid JSON object where keys are field IDs and values are inferred field values. Do not include any prose or markdown — only raw JSON.',
          timeoutMs: 10_000,
        });
      } catch (callError) {
        // AC13: a timeout is an expected, benign outcome — fail open quietly.
        if ((callError as Error).message.includes('timed out')) {
          this.logger.warn(
            `[${correlationId}] CS2-3: Claude inference timed out (10s) for task ${taskId} — all fields to manualFields`,
          );
          return {
            filledFields: [],
            manualFields: [...manualFields, ...estimatableFields],
            inferFailed: true,
          };
        }
        // AC16: other call failures bubble to the outer fail-open handler (Sentry capture).
        throw callError;
      }

      // AC14: Parse JSON response
      let inferredValues: Record<string, unknown>;
      try {
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('No JSON found in response');
        inferredValues = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      } catch (parseError) {
        this.logger.error(
          `[${correlationId}] CS2-3: AI response parsing failed: ${(parseError as Error).message}`,
        );
        return {
          filledFields: [],
          manualFields: [...manualFields, ...estimatableFields],
          inferFailed: true,
        };
      }

      const provider = await this.providerFactory.getProvider(integration);

      // AC15: Map and set fields sequentially
      for (const field of estimatableFields) {
        const rawValue = inferredValues[field.id];
        if (rawValue === undefined || rawValue === null) {
          manualFields.push(field);
          continue;
        }

        const mappedValue = this.mapInferredValue(field, rawValue, correlationId);
        if (mappedValue === null) {
          manualFields.push(field);
          continue;
        }

        try {
          await provider.setFieldValue(taskId, field.id, mappedValue);
          filledFields.push({ field, value: mappedValue, source: 'ai_inferred' });
        } catch (error) {
          this.logger.warn(
            `[${correlationId}] CS2-3: setFieldValue failed for inferred field ${field.id} (${field.name}): ${(error as Error).message}`,
          );
          this.sentry.captureException(error as Error);
          manualFields.push(field);
          inferFailed = true;
        }
      }

      return {
        filledFields,
        manualFields,
        inferFailed: inferFailed || undefined,
      };
    } catch (error) {
      // AC3/AC16: Outer fail-open
      this.logger.error(
        `[${correlationId}] CS2-3: AI inference failed: ${(error as Error).message}`,
      );
      this.sentry.captureException(error as Error);
      return {
        filledFields: [],
        manualFields: [...manualFields, ...estimatableFields],
        inferFailed: true,
      };
    }
  }

  /**
   * Helper to match a field against factual patterns.
   * AC4-AC8: Matching patterns implementation.
   */
  private matchField(
    field: NormalizedField,
    ctx: ExecutionContext,
    correlationId: string,
  ): { value: FieldValue; source: string } | null {
    const name = field.name.toLowerCase();

    // AC4: Duration fill rule
    if (field.type === NormalizedFieldType.NUMBER && /time|duration|estimate/.test(name)) {
      if (ctx.executionDurationMinutes !== undefined && isFinite(ctx.executionDurationMinutes)) {
        return { value: ctx.executionDurationMinutes, source: 'execution_duration' };
      }
      this.logMissingContext(field, 'executionDurationMinutes', correlationId);
      return null;
    }

    // AC5: Deployed-at date fill rule
    if (field.type === NormalizedFieldType.DATE && /completion|deployed|done/.test(name)) {
      if (ctx.deployedAt instanceof Date) {
        return { value: ctx.deployedAt.getTime(), source: 'deployed_at' };
      }
      this.logMissingContext(field, 'deployedAt', correlationId);
      return null;
    }

    // AC6: PR URL fill rule
    if (
      (field.type === NormalizedFieldType.URL || field.type === NormalizedFieldType.TEXT) &&
      /pr|pull[\s_-]?request/.test(name)
    ) {
      if (ctx.prUrl) {
        return { value: ctx.prUrl, source: 'pr_url' };
      }
      this.logMissingContext(field, 'prUrl', correlationId);
      return null;
    }

    // AC7: Branch name fill rule
    if (field.type === NormalizedFieldType.TEXT && /branch/.test(name)) {
      if (ctx.branchName) {
        return { value: ctx.branchName, source: 'branch_name' };
      }
      this.logMissingContext(field, 'branchName', correlationId);
      return null;
    }

    return null; // AC8: No match
  }

  /**
   * AC12: Build prompt with task and execution context.
   */
  private buildInferencePrompt(fields: NormalizedField[], ctx: InferenceContext): string {
    const fieldsJson = fields.map((f) => ({
      id: f.id,
      name: f.name,
      type: f.type,
      options: f.options,
    }));

    const contextLines: string[] = [];
    if (ctx.executionDurationMinutes !== undefined) {
      contextLines.push(`- Duration: ${ctx.executionDurationMinutes.toFixed(1)} minutes`);
    }
    if (ctx.retryCount !== undefined && ctx.retryCount > 0) {
      contextLines.push(
        `- Retry Count: ${ctx.retryCount} (task required ${ctx.retryCount} retry/retries — higher complexity indicator)`,
      );
    }
    if (ctx.filesChangedCount !== undefined) {
      contextLines.push(`- Files Changed: ${ctx.filesChangedCount}`);
    }

    return `Task Title: ${ctx.ticketTitle ?? '(not provided)'}
Task Description: ${ctx.ticketDescription ?? '(not provided)'}

Execution Context:
${contextLines.length > 0 ? contextLines.join('\n') : '(no additional context available)'}

Requested Fields:
${JSON.stringify(fieldsJson, null, 2)}

Instructions:
1. For DROPDOWN or LABELS fields, return the exact option label text (not the ID) — the system will map it to the correct ID.
2. For NUMBER, return a number. For story points, use standard Fibonacci (1, 2, 3, 5, 8, 13).
3. For CHECKBOX, return exactly "true" or "false" as a string.
4. For TEXT or URL, return a string.
5. If you cannot confidently infer a field, omit it from the response entirely.
6. Return ONLY a JSON object where keys are field IDs and values are your inferences.

Example Output:
{
  "field_id_1": "High",
  "field_id_2": 3,
  "field_id_3": "true"
}`;
  }

  /**
   * AC15: Map inferred value to appropriate type.
   */
  private mapInferredValue(
    field: NormalizedField,
    value: unknown,
    correlationId: string,
  ): FieldValue | null {
    if (value === null || value === undefined) return null;

    const strVal = String(value);

    switch (field.type) {
      case NormalizedFieldType.DROPDOWN: {
        const match = field.options?.find((o) => o.label.toLowerCase() === strVal.toLowerCase());
        if (!match) {
          this.logger.debug(
            `[${correlationId}] CS2-3: dropdown field "${field.name}" — no option match for AI value "${strVal}" — adding to manualFields`,
          );
          return null;
        }
        return match.id as FieldValue;
      }
      case NormalizedFieldType.NUMBER: {
        const num = Number(strVal);
        return isNaN(num) ? null : num;
      }
      case NormalizedFieldType.CHECKBOX: {
        const lower = strVal.toLowerCase();
        if (lower === 'true') return true;
        if (lower === 'false') return false;
        return null;
      }
      case NormalizedFieldType.LABELS:
        if (Array.isArray(value)) return value;
        return typeof value === 'string' ? [value] : null;
      case NormalizedFieldType.TEXT:
      case NormalizedFieldType.URL:
      case NormalizedFieldType.DATE:
        return strVal as FieldValue;
      default:
        return null;
    }
  }

  private logMissingContext(field: NormalizedField, ctxKey: string, correlationId: string): void {
    this.logger.debug(
      `[${correlationId}] CS2-2: field "${field.name}" (${field.id}) matches factual pattern "${ctxKey}" but context value is absent — skipping`,
    );
  }
}
