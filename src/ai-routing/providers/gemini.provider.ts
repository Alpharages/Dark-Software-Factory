import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ICodingAgentProvider } from '../interfaces/coding-agent-provider.interface';
import { ProviderName } from '@/ai-routing/enums/provider-name.enum';
import { IAIExecutionPayload } from '@/execution/interfaces';
import { IAIExecutionResult, AIErrorCode, QAAttempt } from '../interfaces/ai-provider.interface';
import { SandboxService } from '@/sandbox/sandbox.service';
import { SandboxResourceProfileService } from '@/sandbox/sandbox-resource-profile.service';
import { ExecutionTrackerService } from '@/execution/execution-tracker.service';

/**
 * Google Gemini CLI Provider
 * Executes the `gemini` command in an OpenSandbox container using the dsf-execution skill.
 */
@Injectable()
export class GeminiProvider implements ICodingAgentProvider {
  private readonly logger = new Logger(GeminiProvider.name);
  readonly providerName = ProviderName.GEMINI;

  get isEnabled(): boolean {
    return this.config.get<boolean>('ai.providers.gemini.enabled', false);
  }

  constructor(
    private readonly config: ConfigService,
    private readonly sandboxService: SandboxService,
    private readonly resourceProfileService: SandboxResourceProfileService,
    private readonly executionTracker: ExecutionTrackerService,
  ) {}

  async isHealthy(): Promise<boolean> {
    const apiKey = this.config.get<string>('gemini.apiKey', '');
    if (!apiKey) return false;
    return this.sandboxService.isHealthy();
  }

  async execute(payload: IAIExecutionPayload): Promise<IAIExecutionResult> {
    const profile = this.resourceProfileService.getProfile(payload.complexityScore ?? 5);

    const apiKey = this.config.get<string>('gemini.apiKey', '');
    const baseURL = this.config.get<string>('gemini.baseURL', '');
    const model = this.config.get<string>('gemini.model', 'gemini-2.5-pro');
    const githubToken = this.config.get<string>('github.token', '');

    const sanitizedTicket =
      payload.ticketId
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || 'ticket';
    const featureBranch = `dsf/${sanitizedTicket}/${payload.executionId.slice(0, 8)}`;

    const env: Record<string, string> = {
      GEMINI_API_KEY: apiKey,
      GEMINI_MODEL: model,
      IS_SANDBOX: '1',
      REPO_URL: payload.repositoryUrl,
      FEATURE_BRANCH: payload.targetBranch ?? featureBranch,
      TASK_DESCRIPTION: payload.prompt,
      GITHUB_TOKEN: githubToken,
      QA_MAX_RETRIES: String(payload.qaMaxRetries ?? 3), // WR-5.2
    };
    if (baseURL) {
      env['GEMINI_BASE_URL'] = baseURL;
    }

    // Capture structured result from stdout (AC-3)
    let agentResult: {
      prUrl?: string | null;
      commitSha?: string;
      branchName?: string;
      qaStatus?: 'passed' | 'self_healed' | 'failed';
      qaRetryCount?: number;
    } = {};
    const qaAttempts: QAAttempt[] = [];

    const onStdoutLine = (line: string): void => {
      try {
        const parsed = JSON.parse(line) as { type?: string; pct?: number; msg?: string };
        if (parsed.type === 'progress' && typeof parsed.pct === 'number') {
          // Fire-and-forget progress emission — never blocks execution (NFR-WR3)
          this.executionTracker
            .emitProgress(
              payload.executionId,
              payload.ticketId,
              payload.projectId,
              parsed.msg ?? '',
              parsed.pct,
            )
            .catch((err) =>
              this.logger.error(`Failed to emit progress: ${(err as Error).message}`),
            );
        } else if (parsed.type === 'result') {
          const r = parsed as {
            prUrl?: string | null;
            commitSha?: string;
            branchName?: string;
            qaStatus?: 'passed' | 'self_healed' | 'failed';
            qaRetryCount?: number;
          };
          agentResult = { ...agentResult, ...r };
          this.logger.debug(
            `[${payload.executionId}] Agent result captured: qaStatus=${agentResult.qaStatus}`,
          );
        } else if (parsed.type === 'qa_attempt') {
          const a = parsed as unknown as {
            attempt: number;
            lintPassed: boolean;
            lintErrors?: { count: number; details: unknown[] };
            testsPassed: boolean;
            testResults?: { passed: number; failed: number; details: unknown[] };
            durationMs: number;
          };
          if (
            typeof a.attempt === 'number' &&
            typeof a.lintPassed === 'boolean' &&
            typeof a.testsPassed === 'boolean' &&
            typeof a.durationMs === 'number'
          ) {
            qaAttempts.push({
              attemptNumber: a.attempt,
              lintStatus: a.lintPassed ? 'passed' : 'failed',
              testStatus: a.testsPassed ? 'passed' : 'failed',
              lintErrors: a.lintErrors,
              testResults: a.testResults,
              durationMs: a.durationMs,
            });
            this.logger.debug(
              `[GeminiProvider] QA attempt ${a.attempt} captured: lint=${a.lintPassed}, tests=${a.testsPassed}`,
            );
          } else {
            this.logger.debug(`[GeminiProvider] qa_attempt line malformed — skipped`);
          }
        }
      } catch {
        this.logger.debug(
          `[GeminiProvider] Non-JSON stdout line (skipped): ${line.substring(0, 120)}`,
        );
      }
    };

    const result = await this.sandboxService.runAgentCommand({
      executionId: payload.executionId,
      image: this.config.get<string>('opensandbox.agentImage', 'dsf-agents:latest'),
      command: 'gemini execute dsf-execution',
      env,
      timeoutSeconds: this.config.get<number>('opensandbox.sandboxTimeoutS', 3600),
      cpuLimit: profile.cpuLimit,
      memoryLimit: profile.memoryLimit,
      ticketId: payload.ticketId,
      onStdoutLine,
      metadata: {
        providerName: ProviderName.GEMINI,
        executionId: payload.executionId,
        ticketId: payload.ticketId,
      },
    });

    // Fallback: scan buffered stdout if onStdoutLine missed a result or qa_attempt lines.
    // needQAAttempts is captured before the loop so all qa_attempt lines are recovered (not just one).
    // unshift preserves natural emission order (stdout is reversed for scanning).
    const needResult = !('qaStatus' in agentResult);
    const needQAAttempts = qaAttempts.length === 0;
    if (needResult || needQAAttempts) {
      const lines = result.stdout.split('\n').reverse();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as {
            type?: string;
            prUrl?: string | null;
            commitSha?: string;
            branchName?: string;
            qaStatus?: 'passed' | 'self_healed' | 'failed';
            qaRetryCount?: number;
          };
          if (parsed.type === 'result' && needResult && !('qaStatus' in agentResult)) {
            agentResult = { ...agentResult, ...parsed };
          } else if (parsed.type === 'qa_attempt' && needQAAttempts) {
            const a = parsed as unknown as {
              attempt: number;
              lintPassed: boolean;
              lintErrors?: { count: number; details: unknown[] };
              testsPassed: boolean;
              testResults?: { passed: number; failed: number; details: unknown[] };
              durationMs: number;
            };
            if (
              typeof a.attempt === 'number' &&
              typeof a.lintPassed === 'boolean' &&
              typeof a.testsPassed === 'boolean' &&
              typeof a.durationMs === 'number'
            ) {
              qaAttempts.unshift({
                attemptNumber: a.attempt,
                lintStatus: a.lintPassed ? 'passed' : 'failed',
                testStatus: a.testsPassed ? 'passed' : 'failed',
                lintErrors: a.lintErrors,
                testResults: a.testResults,
                durationMs: a.durationMs,
              });
            }
          }
        } catch {
          // skip
        }
      }
    }

    const exitedClean = result.exitCode === 0 && !result.timedOut;
    const resultReceived = agentResult.qaStatus !== undefined;
    const qaFailed = agentResult.qaStatus === 'failed';
    const success = exitedClean && resultReceived && !qaFailed;

    if (!success) {
      const errorMessage = result.timedOut
        ? 'Gemini sandbox execution timed out'
        : this.categorizeError(`${result.stdout}\n${result.stderr}`) ||
          (!resultReceived
            ? 'Agent did not emit a final result line — execution may have crashed'
            : qaFailed
              ? 'Agent completed with QA failures after all retries'
              : 'Agent process exited with non-zero code after emitting result');

      return {
        success: false,
        codeDiff: null,
        filesChanged: [],
        confidenceScore: 0.0,
        durationMs: result.durationMs,
        workspacePath: '',
        prUrl: agentResult.prUrl ?? undefined,
        commitSha: agentResult.commitSha,
        branchName: agentResult.branchName || payload.targetBranch || featureBranch,
        qaStatus: agentResult.qaStatus ?? 'skipped',
        qaRetryCount: agentResult.qaRetryCount ?? 0,
        qaAttempts: qaAttempts.length > 0 ? qaAttempts : undefined,
        error: {
          code: result.timedOut ? AIErrorCode.TIMEOUT : AIErrorCode.PROCESS_CRASH,
          message: errorMessage,
          isRetryable:
            result.timedOut ||
            qaFailed ||
            errorMessage.includes('Rate Limit') ||
            errorMessage.includes('429'),
          rawOutput: `${result.stdout}\n${result.stderr}`.trim(),
          exitCode: result.exitCode,
        },
      };
    }

    return {
      success: true,
      codeDiff: null,
      filesChanged: [],
      confidenceScore: agentResult.qaStatus === 'passed' ? 0.95 : 0.8,
      durationMs: result.durationMs,
      workspacePath: '',
      prUrl: agentResult.prUrl ?? undefined,
      commitSha: agentResult.commitSha,
      branchName: agentResult.branchName || featureBranch,
      qaStatus: agentResult.qaStatus,
      qaRetryCount: agentResult.qaRetryCount,
      qaAttempts: qaAttempts.length > 0 ? qaAttempts : undefined,
    };
  }

  /**
   * Categorize common sandbox errors based on output patterns.
   * Story WR-3.2: Error Classification logic.
   */
  private categorizeError(output: string): string | null {
    if (/rate limit|too many requests|429/i.test(output)) {
      return 'Gemini Rate Limit exceeded (429)';
    }
    if (
      /getaddrinfo ENOTFOUND/i.test(output) ||
      /unable to access/i.test(output) ||
      /could not read from remote repository/i.test(output)
    ) {
      return 'Repository Unreachable (Network/Auth Error)';
    }
    if (
      /OutOfMemory/i.test(output) ||
      /OOMKill|oom-kill/i.test(output) ||
      /allocation failed/i.test(output) ||
      /killed.*memory|memory.*killed/i.test(output)
    ) {
      return 'Sandbox Out-of-Memory (OOM)';
    }
    return null;
  }
}
