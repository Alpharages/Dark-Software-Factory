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
    // Claude Code reads these for API access
    const apiKey = this.config.get<string>('anthropic.apiKey', '');
    const baseURL = this.config.get<string>('anthropic.baseURL', '');
    const model = this.config.get<string>('anthropic.model', 'claude-sonnet-4-20250514');

    // dsf-execution Skill requirements
    const env: Record<string, string> = {
      ANTHROPIC_API_KEY: apiKey,
      ANTHROPIC_MODEL: model,
      IS_SANDBOX: '1',
      // Agentic Workflow Inputs
      REPO_URL: repositoryUrl || '',
      FEATURE_BRANCH: targetBranch || `dsf/fix-${ticketId}-${Date.now()}`,
      TASK_DESCRIPTION: prompt,
      GITHUB_TOKEN: this.config.get<string>('github.token', ''),
      QA_MAX_RETRIES: '3', // AC 1.3
    };

    if (baseURL) {
      env['ANTHROPIC_BASE_URL'] = baseURL;
    }

    // Results to be captured from structured stdout
    let agentResult: {
      prUrl?: string;
      commitSha?: string;
      branchName?: string;
      qaStatus?: string;
      qaRetryCount?: number;
    } = {};

    const result = await this.sandboxService.runAgentCommand({
      executionId,
      ticketId,
      image: this.config.get<string>('opensandbox.agentImage', 'dsf-agents:latest'),
      // Trigger the dsf-execution skill (WR-2.2) via slash command
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
      // AC 1.4: Real-time progress and result parsing
      onStdoutLine: (line) => {
        try {
          // Lines starting with markers identify structured data from skill.md
          if (line.startsWith('pct:')) {
            // pct:82:Starting QA self-healing
            const parts = line.split(':');
            if (parts.length >= 3) {
              const percent = parseInt(parts[1], 10);
              const step = parts.slice(2).join(':');

              // Emit progress via service (fire-and-forget inside callback)
              this.executionTracker
                .emitProgress(executionId, ticketId || '', projectId || null, step, percent)
                .catch((err) => this.logger.error(`Failed to emit progress: ${err.message}`));
            }
          } else if (line.startsWith('result:')) {
            // result:{"prUrl":"...","qaStatus":"PASSED",...}
            const jsonText = line.substring(7).trim();
            const parsed = JSON.parse(jsonText);
            agentResult = { ...agentResult, ...parsed };
            this.logger.debug(`[${executionId}] Agent result captured phase: ${parsed.qaStatus}`);
          }
        } catch (_err) {
          // NFR-WR4: Skip parsing if line is not valid JSON/marker — never crash
          this.logger.debug(
            `[${executionId}] Skipping non-structured line: ${line.substring(0, 50)}...`,
          );
        }
      },
    });

    const success = result.exitCode === 0 && !result.timedOut;

    // Final result composition merging sandbox stats and agentic output
    return {
      success: success && agentResult.qaStatus === 'PASSED', // Hard failure if QA failed
      codeDiff: null, // Diff is internal to PR/Branch now, raw stdout is now structured logs
      filesChanged: [], // Legacy field
      confidenceScore: success ? 0.9 : 0.0,
      durationMs: result.durationMs,
      workspacePath: '',
      // Map extended fields from WR-2.1 contract
      prUrl: agentResult.prUrl,
      commitSha: agentResult.commitSha,
      branchName: agentResult.branchName || env.FEATURE_BRANCH,
      qaStatus: agentResult.qaStatus as 'passed' | 'self_healed' | 'failed' | undefined,
      qaRetryCount: agentResult.qaRetryCount,
      ...(success && agentResult.qaStatus === 'PASSED'
        ? {}
        : {
            error: {
              code: result.timedOut ? AIErrorCode.TIMEOUT : AIErrorCode.PROCESS_CRASH,
              message:
                agentResult.qaStatus === 'FAILED'
                  ? 'Agentic delivery failed: QA self-healing exhausted retries'
                  : result.stderr || 'Claude Code execution failed in sandbox',
              isRetryable: result.timedOut || agentResult.qaStatus === 'FAILED',
              rawOutput: `${result.stdout}\n${result.stderr}`.trim(),
              exitCode: result.exitCode,
            },
          }),
    };
  }
}
