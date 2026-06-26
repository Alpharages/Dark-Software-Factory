import { Injectable, Logger } from '@nestjs/common';
import {
  PredictFileModificationsInput,
  PredictFileModificationsResult,
} from './interfaces/file-prediction.interface';
import { MetricsService } from '@/common/metrics/metrics.service';
import { SubscriptionCompletionService } from '@/common/ai/subscription-completion.service';

/**
 * Thin AI delegation wrapper for file modification prediction (AC#1).
 *
 * Delegates to the Claude subscription (SubscriptionCompletionService) and
 * returns strict JSON; falls back to a keyword heuristic when AI is
 * unavailable or fails.
 */
@Injectable()
export class FilePredictionProvider {
  private readonly logger = new Logger(FilePredictionProvider.name);

  constructor(
    private readonly metrics: MetricsService,
    private readonly subscription: SubscriptionCompletionService,
  ) {}

  async predict(input: PredictFileModificationsInput): Promise<PredictFileModificationsResult> {
    // Fallback path (environments without the first-party `claude` CLI available)
    if (!(await this.subscription.isAvailable())) {
      this.safeIncrementCounter('file_prediction_ai_failures_total', { reason: 'not_configured' });
      return this.heuristicFallback(input, 'AI provider not configured (claude CLI unavailable).');
    }

    const prompt = this.buildPrompt(input);

    try {
      const text = (await this.subscription.complete(prompt)).trim();

      const parsed = this.parseStrictJson(text);
      return {
        filePaths: Array.isArray(parsed.filePaths) ? parsed.filePaths : [],
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.4,
        reasoning:
          typeof parsed.reasoning === 'string' ? parsed.reasoning : 'No reasoning returned',
      };
    } catch (_error) {
      const msg = _error instanceof Error ? _error.message : String(_error);

      // Classify error type for better alerting
      const errorType = this.classifyError(_error);
      this.logger.error(`AI prediction failed (${errorType}), using heuristic fallback: ${msg}`, {
        ticketId: input.ticketId,
        errorType,
      });

      // Metrics: Track AI failures by type
      this.safeIncrementCounter('file_prediction_ai_failures_total', { reason: errorType });

      return this.heuristicFallback(input, `AI prediction failed (${errorType}): ${msg}`);
    }
  }

  private buildPrompt(input: PredictFileModificationsInput): string {
    const title = (input.ticketTitle ?? '').slice(0, 300);
    const description = (input.ticketDescription ?? '').slice(0, 3000);

    return `You are assisting an orchestrator that needs to prevent merge conflicts.

Given this ticket, predict which repo-relative file paths are likely to be modified.

CONTEXT:
- repo: ${input.repoFullName}
- ticketId: ${input.ticketId}
- title: ${title}
- description: ${description}

REQUIREMENTS:
- Return ONLY strict JSON (no markdown, no commentary)
- filePaths must be repo-relative paths (no leading "/" and no absolute paths)
- Deduplicate paths
- Provide best-effort confidence in [0,1]
- Keep filePaths to max 25 entries

JSON SCHEMA:
{
  "filePaths": ["src/.../file.ts"],
  "confidence": 0.0,
  "reasoning": "short explanation"
}`;
  }

  private parseStrictJson(text: string): {
    filePaths?: string[];
    confidence?: number;
    reasoning?: string;
  } {
    // Prefer first JSON object in the response
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error('No JSON object found in AI response');
    }
    return JSON.parse(match[0]);
  }

  private heuristicFallback(
    input: PredictFileModificationsInput,
    note: string,
  ): PredictFileModificationsResult {
    const combined = `${input.ticketTitle ?? ''}\n\n${input.ticketDescription ?? ''}`.toLowerCase();
    const filePaths: string[] = [];

    if (combined.includes('prisma') || combined.includes('migration')) {
      filePaths.push('prisma/schema.prisma', 'prisma/migrations/');
    }
    if (combined.includes('auth')) {
      filePaths.push('src/auth/');
    }
    if (combined.includes('lock')) {
      filePaths.push('src/file-locks/');
    }

    return {
      filePaths: Array.from(new Set(filePaths)),
      confidence: 0.35,
      reasoning: `${note} Heuristic guess based on keywords in ticket text.`,
    };
  }

  private classifyError(error: unknown): string {
    if (!(error instanceof Error)) return 'unknown';

    const msg = error.message.toLowerCase();

    // Rate limit errors
    if (msg.includes('rate limit') || msg.includes('429')) return 'rate_limit';

    // Authentication errors
    if (msg.includes('authentication') || msg.includes('401') || msg.includes('api key'))
      return 'auth_error';

    // Network errors
    if (msg.includes('network') || msg.includes('timeout') || msg.includes('econnrefused'))
      return 'network_error';

    // JSON parsing errors
    if (msg.includes('json') || msg.includes('parse')) return 'parse_error';

    return 'api_error';
  }

  private safeIncrementCounter(metricName: string, labels: Record<string, string>): void {
    try {
      this.metrics.incrementCounter(metricName, labels);
    } catch (err) {
      this.logger.debug(`Metrics increment failed for ${metricName}: ${(err as Error).message}`);
    }
  }
}
