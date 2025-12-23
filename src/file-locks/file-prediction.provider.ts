import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import {
  PredictFileModificationsInput,
  PredictFileModificationsResult,
} from './interfaces/file-prediction.interface';
import { MetricsService } from '@/common/metrics/metrics.service';

/**
 * Thin AI delegation wrapper for file modification prediction (AC#1).
 *
 * Implementation will delegate to an AI provider and return strict JSON.
 */
@Injectable()
export class FilePredictionProvider {
  private readonly logger = new Logger(FilePredictionProvider.name);
  private client: Anthropic | null = null;
  private model: string;
  private maxTokens: number;

  constructor(
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
  ) {
    this.model = this.config.get<string>('anthropic.model') || 'claude-sonnet-4-20250514';
    this.maxTokens = this.config.get<number>('anthropic.maxTokens') || 1200;

    const apiKey = this.config.get<string>('anthropic.apiKey');
    if (apiKey) {
      this.client = new Anthropic({ apiKey });
    }
  }

  async predict(input: PredictFileModificationsInput): Promise<PredictFileModificationsResult> {
    // Fallback path (dev/test environments often won't have ANTHROPIC_API_KEY)
    if (!this.client) {
      this.safeIncrementCounter('file_prediction_ai_failures_total', { reason: 'not_configured' });
      return this.heuristicFallback(
        input,
        'AI provider not configured (missing ANTHROPIC_API_KEY).',
      );
    }

    const prompt = this.buildPrompt(input);

    try {
      const message = await this.client.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        temperature: 0.2,
        messages: [{ role: 'user', content: prompt }],
      });

      const text = message.content
        .map((b) => (b.type === 'text' ? b.text : ''))
        .filter(Boolean)
        .join('\n')
        .trim();

      const parsed = this.parseStrictJson(text);
      return {
        filePaths: Array.isArray(parsed.filePaths) ? parsed.filePaths : [],
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.4,
        reasoning:
          typeof parsed.reasoning === 'string' ? parsed.reasoning : 'No reasoning returned',
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);

      // Classify error type for better alerting
      const errorType = this.classifyError(error);
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

  private parseStrictJson(text: string): any {
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
