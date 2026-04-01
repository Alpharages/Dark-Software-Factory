import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ICodingAgentProvider } from '../interfaces/coding-agent-provider.interface';
import { ProviderName } from '@/ai-routing/enums/provider-name.enum';
import { IAIExecutionPayload } from '@/execution/interfaces';
import { IAIExecutionResult, AIErrorCode } from '../interfaces/ai-provider.interface';
import { SandboxService } from '@/sandbox/sandbox.service';
import { SandboxResourceProfileService } from '@/sandbox/sandbox-resource-profile.service';
import { ExecutionTrackerService } from '@/execution/execution-tracker.service';

/** Structured result emitted by the agent at the end of execution */
interface SandboxResultLine {
  type: 'result';
  prUrl: string | null;
  commitSha: string;
  branchName: string;
  qaStatus: 'passed' | 'self_healed' | 'failed';
  qaRetryCount: number;
}

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
    const QA_MAX_RETRIES = '3';

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
      QA_MAX_RETRIES,
    };
    if (baseURL) {
      env['GEMINI_BASE_URL'] = baseURL;
    }

    let sandboxResult: SandboxResultLine | null = null;

    const onStdoutLine = (line: string): void => {
      try {
        const parsed = JSON.parse(line) as { type?: string; pct?: number; msg?: string };
        if (parsed.type === 'progress' && typeof parsed.pct === 'number') {
          void this.executionTracker.emitProgress(
            payload.executionId,
            payload.ticketId,
            payload.projectId,
            parsed.msg ?? '',
            parsed.pct,
          );
        } else if (parsed.type === 'result') {
          sandboxResult = parsed as SandboxResultLine;
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

    // Fallback: scan buffered stdout if onStdoutLine never captured a result line
    if (!sandboxResult) {
      const lines = result.stdout.split('\n').reverse();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as { type?: string };
          if (parsed.type === 'result') {
            sandboxResult = parsed as SandboxResultLine;
            break;
          }
        } catch {
          // skip
        }
      }
    }

    const exitedClean = result.exitCode === 0 && !result.timedOut;
    const qaFailed = sandboxResult?.qaStatus === 'failed';
    const success = exitedClean && sandboxResult !== null && !qaFailed;

    if (!success || !sandboxResult) {
      const errorMessage = result.timedOut
        ? 'Gemini sandbox execution timed out'
        : sandboxResult === null
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
        prUrl: sandboxResult?.prUrl ?? undefined,
        commitSha: sandboxResult?.commitSha,
        branchName: sandboxResult?.branchName ?? payload.targetBranch ?? featureBranch,
        qaStatus: sandboxResult?.qaStatus ?? 'skipped',
        qaRetryCount: sandboxResult?.qaRetryCount ?? 0,
        error: {
          code: result.timedOut ? AIErrorCode.TIMEOUT : AIErrorCode.PROCESS_CRASH,
          message: errorMessage,
          isRetryable: result.timedOut,
          rawOutput: `${result.stdout}\n${result.stderr}`.trim(),
          exitCode: result.exitCode,
        },
      };
    }

    return {
      success: true,
      codeDiff: null,
      filesChanged: [],
      confidenceScore: sandboxResult.qaStatus === 'passed' ? 0.95 : 0.8,
      durationMs: result.durationMs,
      workspacePath: '',
      prUrl: sandboxResult.prUrl ?? undefined,
      commitSha: sandboxResult.commitSha,
      branchName: sandboxResult.branchName,
      qaStatus: sandboxResult.qaStatus,
      qaRetryCount: sandboxResult.qaRetryCount,
    };
  }
}
