import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ICodingAgentProvider } from '@/ai-routing/interfaces';
import { ProviderName } from '@/ai-routing/enums/provider-name.enum';
import { IAIExecutionPayload } from '@/execution/interfaces';
import { IAIExecutionResult, AIErrorCode } from '@/ai-routing/interfaces';
import { SandboxService } from '@/sandbox/sandbox.service';
import { SandboxResourceProfileService } from '@/sandbox/sandbox-resource-profile.service';
import { ExecutionTrackerService } from '@/execution/execution-tracker.service';

/**
 * OpenAI Codex CLI Provider
 * Executes the `codex` command in an OpenSandbox container using the dsf-execution skill.
 */
@Injectable()
export class CodexProvider implements ICodingAgentProvider {
  private readonly logger = new Logger(CodexProvider.name);
  readonly providerName = ProviderName.CODEX;

  get isEnabled(): boolean {
    return this.config.get<boolean>('ai.providers.codex.enabled', false);
  }

  constructor(
    private readonly config: ConfigService,
    private readonly sandboxService: SandboxService,
    private readonly resourceProfileService: SandboxResourceProfileService,
    private readonly executionTracker: ExecutionTrackerService,
  ) {}

  async isHealthy(): Promise<boolean> {
    const apiKey = this.config.get<string>('codex.apiKey', '');
    if (!apiKey) return false;
    return this.sandboxService.isHealthy();
  }

  async execute(payload: IAIExecutionPayload): Promise<IAIExecutionResult> {
    const profile = this.resourceProfileService.getProfile(payload.complexityScore ?? 5);

    const apiKey = this.config.get<string>('codex.apiKey', '');
    const baseURL = this.config.get<string>('codex.baseURL', '');
    const model = this.config.get<string>('codex.model', 'codex-1');
    const githubToken = this.config.get<string>('github.token', '');
    const QA_MAX_RETRIES = '3';

    const sanitizedTicket =
      payload.ticketId
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || 'ticket';
    const featureBranch = `dsf/${sanitizedTicket}/${payload.executionId.slice(0, 8)}`;

    const env: Record<string, string> = {
      OPENAI_API_KEY: apiKey,
      CODEX_MODEL: model,
      IS_SANDBOX: '1',
      REPO_URL: payload.repositoryUrl,
      FEATURE_BRANCH: payload.targetBranch ?? featureBranch,
      TASK_DESCRIPTION: payload.prompt,
      GITHUB_TOKEN: githubToken,
      QA_MAX_RETRIES,
    };
    if (baseURL) {
      env['OPENAI_BASE_URL'] = baseURL;
    }

    // Capture structured result from stdout (AC-3)
    let agentResult: {
      prUrl?: string | null;
      commitSha?: string;
      branchName?: string;
      qaStatus?: 'passed' | 'self_healed' | 'failed';
      qaRetryCount?: number;
    } = {};

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
        }
      } catch {
        this.logger.debug(
          `[CodexProvider] Non-JSON stdout line (skipped): ${line.substring(0, 120)}`,
        );
      }
    };

    const result = await this.sandboxService.runAgentCommand({
      executionId: payload.executionId,
      image: this.config.get<string>('opensandbox.agentImage', 'dsf-agents:latest'),
      command: 'codex execute dsf-execution',
      env,
      timeoutSeconds: this.config.get<number>('opensandbox.sandboxTimeoutS', 3600),
      cpuLimit: profile.cpuLimit,
      memoryLimit: profile.memoryLimit,
      ticketId: payload.ticketId,
      onStdoutLine,
      metadata: {
        providerName: ProviderName.CODEX,
        executionId: payload.executionId,
        ticketId: payload.ticketId,
      },
    });

    // Fallback: scan buffered stdout if onStdoutLine never captured a result line
    if (!('qaStatus' in agentResult)) {
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
          if (parsed.type === 'result') {
            agentResult = { ...agentResult, ...parsed };
            break;
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
        ? 'Codex sandbox execution timed out'
        : !resultReceived
          ? 'Agent did not emit a final result line — execution may have crashed'
          : qaFailed
            ? 'Agent completed with QA failures after all retries'
            : 'Agent process exited with non-zero code after emitting result';

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
        error: {
          code: result.timedOut ? AIErrorCode.TIMEOUT : AIErrorCode.PROCESS_CRASH,
          message: errorMessage,
          isRetryable: result.timedOut || qaFailed,
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
    };
  }
}
