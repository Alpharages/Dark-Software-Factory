import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'child_process';

export interface SubscriptionCompletionOptions {
  /** Optional system prompt appended via `--append-system-prompt`. */
  system?: string;
  /** Model alias (e.g. 'sonnet'/'haiku') or full id. Defaults to the configured subscription model. */
  model?: string;
  /** Hard timeout for the child process. Defaults to 30s. */
  timeoutMs?: number;
}

/**
 * One-shot completion helper backed by the first-party `claude` CLI on the
 * Claude subscription — the same plan-limit path the agent runtime uses
 * (scripts/claude-run-skill.sh). This replaces all direct, pay-per-token
 * `@anthropic-ai/sdk` usage in DSF: every AI call must draw the subscription,
 * never the API key (DSF requires zero marginal Anthropic spend).
 *
 * It shells out to `claude -p "<prompt>" --output-format json --max-turns 1`
 * with ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN unset for the child so the CLI
 * authenticates against the subscription login rather than an inherited key.
 */
@Injectable()
export class SubscriptionCompletionService {
  private readonly logger = new Logger(SubscriptionCompletionService.name);
  private readonly cliPath: string;
  private readonly defaultModel: string;
  private readonly defaultTimeoutMs: number;

  private availabilityPromise: Promise<boolean> | null = null;

  constructor(private readonly config: ConfigService) {
    this.cliPath = this.config.get<string>('anthropic.subscriptionCliPath') || 'claude';
    this.defaultModel = this.config.get<string>('anthropic.subscriptionModel') || 'sonnet';
    this.defaultTimeoutMs = this.config.get<number>('anthropic.subscriptionTimeoutMs') || 30_000;
  }

  /**
   * Whether the `claude` CLI is invocable (checked once, then cached).
   * Consumers gate on this instead of the removed `anthropic.apiKey`.
   */
  async isAvailable(): Promise<boolean> {
    if (!this.availabilityPromise) {
      this.availabilityPromise = this.checkCli();
    }
    return this.availabilityPromise;
  }

  /**
   * Run a single-turn completion and return the assistant's text.
   * Throws on timeout, non-zero exit, missing CLI, or unparseable output —
   * callers are expected to fail open to their existing fallback behaviour.
   */
  async complete(prompt: string, options: SubscriptionCompletionOptions = {}): Promise<string> {
    const model = options.model || this.defaultModel;
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;

    const args = ['-p', prompt, '--model', model, '--output-format', 'json', '--max-turns', '1'];
    if (options.system) {
      args.push('--append-system-prompt', options.system);
    }

    // Force the CLI onto the subscription login: an inherited ANTHROPIC_API_KEY
    // (DSF keeps none now, but be defensive) would bill the API instead of the plan.
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;

    return new Promise<string>((resolve, reject) => {
      const child = spawn(this.cliPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });

      let stdout = '';
      let stderr = '';
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill('SIGKILL');
        reject(new Error(`Subscription completion timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      child.stdout.on('data', (chunk) => (stdout += chunk.toString()));
      child.stderr.on('data', (chunk) => (stderr += chunk.toString()));

      child.on('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });

      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);

        if (code !== 0) {
          reject(new Error(`claude CLI exited with code ${code}: ${stderr.trim().slice(0, 500)}`));
          return;
        }

        try {
          const envelope = JSON.parse(stdout) as { result?: unknown; is_error?: boolean };
          if (envelope.is_error) {
            reject(new Error(`claude CLI reported an error result: ${stdout.slice(0, 500)}`));
            return;
          }
          const text = typeof envelope.result === 'string' ? envelope.result : '';
          resolve(text);
        } catch (parseError) {
          reject(
            new Error(`Failed to parse claude CLI JSON output: ${(parseError as Error).message}`),
          );
        }
      });
    });
  }

  private checkCli(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const done = (available: boolean) => {
        if (settled) return;
        settled = true;
        if (!available) {
          this.logger.warn(
            `Subscription completion unavailable: '${this.cliPath}' CLI not invocable — AI features fall back to non-AI behaviour`,
          );
        }
        resolve(available);
      };

      try {
        const child = spawn(this.cliPath, ['--version'], { stdio: 'ignore' });
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          done(false);
        }, 5_000);
        child.on('error', () => {
          clearTimeout(timer);
          done(false);
        });
        child.on('close', (code) => {
          clearTimeout(timer);
          done(code === 0);
        });
      } catch {
        done(false);
      }
    });
  }
}
