import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ICodingAgentProvider } from '@/ai-routing/interfaces';
import { ProviderName } from '@/ai-routing/enums/provider-name.enum';
import { IAIExecutionPayload } from '@/execution/interfaces';
import { IAIExecutionResult, AIErrorCode } from '@/ai-routing/interfaces';
import { SandboxService } from '@/sandbox/sandbox.service';
import { SandboxResourceProfileService } from '@/sandbox/sandbox-resource-profile.service';
import { ExecutionTrackerService } from '@/execution/execution-tracker.service';

@Injectable()
export class ClaudeCodeProvider implements ICodingAgentProvider {
  readonly providerName = ProviderName.CLAUDE_CODE;
  private readonly logger = new Logger(ClaudeCodeProvider.name);

  get isEnabled(): boolean {
    return this.config.get<boolean>('ai.providers.claudeCode.enabled', false);
  }

  constructor(
    private readonly config: ConfigService,
    private readonly sandboxService: SandboxService,
    private readonly resourceProfileService: SandboxResourceProfileService,
    private readonly executionTracker: ExecutionTrackerService,
  ) {}

  async isHealthy(): Promise<boolean> {
    return this.sandboxService.isHealthy();
  }

  async execute(payload: IAIExecutionPayload): Promise<IAIExecutionResult> {
    const { executionId, ticketId, projectId, prompt, repositoryUrl, targetBranch } = payload;

    // Get resource limits from complexity score (OS-2.1 contract)
    const profile = this.resourceProfileService.getProfile(payload.complexityScore ?? 5);

    // Build environment — never log raw env (NFR-OS5)
    const apiKey = this.config.get<string>('anthropic.apiKey', '');
    const baseURL = this.config.get<string>('anthropic.baseURL', '');
    const model = this.config.get<string>('anthropic.model', 'claude-sonnet-4-20250514');

    // P1: git-safe branch name — dsf/{sanitized-ticket}/{exec-prefix-8}
    const sanitizedTicket = (ticketId || '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    const featureBranch = `dsf/${sanitizedTicket}/${executionId.slice(0, 8)}`;

    // dsf-execution Skill requirements (AC-1)
    const env: Record<string, string> = {
      ANTHROPIC_API_KEY: apiKey,
      ANTHROPIC_MODEL: model,
      IS_SANDBOX: '1',
      REPO_URL: repositoryUrl || '',
      FEATURE_BRANCH: targetBranch ?? featureBranch,
      TASK_DESCRIPTION: prompt,
      GITHUB_TOKEN: this.config.get<string>('github.token', ''),
      QA_MAX_RETRIES: String(payload.qaMaxRetries ?? 3), // WR-5.2
    };

    if (baseURL) {
      env['ANTHROPIC_BASE_URL'] = baseURL;
    }

    // Capture structured result from stdout (AC-3)
    let agentResult: {
      prUrl?: string | null;
      commitSha?: string;
      branchName?: string;
      qaStatus?: 'passed' | 'self_healed' | 'failed';
      qaRetryCount?: number;
    } = {};

    const result = await this.sandboxService.runAgentCommand({
      executionId,
      ticketId,
      image: this.config.get<string>('opensandbox.agentImage', 'dsf-agents:latest'),
      command: 'claude --dangerously-skip-permissions -p "/dsf-execution"',
      env,
      timeoutSeconds: this.config.get<number>('opensandbox.sandboxTimeoutS', 3600),
      cpuLimit: profile.cpuLimit,
      memoryLimit: profile.memoryLimit,
      metadata: {
        providerName: ProviderName.CLAUDE_CODE,
        executionId,
        ticketId: ticketId || '',
      },
      // AC-2: JSON stdout protocol — {"type":"progress","pct":N,"msg":"..."} | {"type":"result",...}
      onStdoutLine: (line) => {
        try {
          const parsed = JSON.parse(line) as { type?: string; pct?: number; msg?: string };
          if (parsed.type === 'progress' && typeof parsed.pct === 'number') {
            // Fire-and-forget progress emission — never blocks execution (NFR-WR3)
            this.executionTracker
              .emitProgress(
                executionId,
                ticketId || '',
                projectId || null,
                parsed.msg ?? '',
                parsed.pct,
              )
              .catch((err) =>
                this.logger.error(`Failed to emit progress: ${(err as Error).message}`),
              );
          } else if (parsed.type === 'result') {
            agentResult = { ...agentResult, ...(parsed as typeof agentResult) };
            this.logger.debug(
              `[${executionId}] Agent result captured: qaStatus=${agentResult.qaStatus}`,
            );
          }
        } catch (_err) {
          // NFR-WR4: Non-JSON line — skip silently, never crash
          this.logger.debug(
            `[${executionId}] Skipping non-structured line: ${line.substring(0, 50)}...`,
          );
        }
      },
    });

    const exitedClean = result.exitCode === 0 && !result.timedOut;
    const resultReceived = agentResult.qaStatus !== undefined;
    const qaFailed = agentResult.qaStatus === 'failed';
    const agenticSuccess = exitedClean && resultReceived && !qaFailed;

    const errorMessage = result.timedOut
      ? 'Claude Code sandbox execution timed out'
      : this.categorizeError(`${result.stdout}\n${result.stderr}`) ||
        (!resultReceived
          ? 'Agent did not emit a final result line — execution may have crashed'
          : qaFailed
            ? 'Agentic delivery failed: QA self-healing exhausted retries'
            : result.stderr || 'Claude Code execution failed in sandbox');

    return {
      success: agenticSuccess,
      codeDiff: null,
      filesChanged: [],
      confidenceScore: agenticSuccess ? 0.9 : 0.0,
      durationMs: result.durationMs,
      workspacePath: '',
      prUrl: agentResult.prUrl ?? undefined,
      commitSha: agentResult.commitSha,
      branchName: agentResult.branchName || env.FEATURE_BRANCH,
      qaStatus: agentResult.qaStatus,
      qaRetryCount: agentResult.qaRetryCount,
      ...(agenticSuccess
        ? {}
        : {
            error: {
              code: result.timedOut ? AIErrorCode.TIMEOUT : AIErrorCode.PROCESS_CRASH,
              message: errorMessage,
              isRetryable: result.timedOut || qaFailed || errorMessage.includes('Rate Limit'),
              rawOutput: `${result.stdout}\n${result.stderr}`.trim(),
              exitCode: result.exitCode,
            },
          }),
    };
  }

  /**
   * Categorize common sandbox errors based on output patterns.
   * Story WR-3.2: Error Classification logic.
   */
  private categorizeError(output: string): string | null {
    if (/rate limit|too many requests|429/i.test(output)) {
      return 'Claude Code Rate Limit exceeded (429)';
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
      /signal 9/i.test(output) ||
      /killed.*memory|memory.*killed/i.test(output)
    ) {
      return 'Sandbox Out-of-Memory (OOM)';
    }
    return null;
  }
}
