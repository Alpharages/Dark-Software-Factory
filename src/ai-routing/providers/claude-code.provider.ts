import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ICodingAgentProvider } from '../interfaces/coding-agent-provider.interface';
import { ProviderName } from '@/ai-routing/enums/provider-name.enum';
import { IAIExecutionPayload } from '@/execution/interfaces';
import { IAIExecutionResult, AIErrorCode } from '../interfaces/ai-provider.interface';
import { SandboxService } from '@/sandbox/sandbox.service';
import { SandboxResourceProfileService } from '@/sandbox/sandbox-resource-profile.service';

@Injectable()
export class ClaudeCodeProvider implements ICodingAgentProvider {
  readonly providerName = ProviderName.CLAUDE_CODE;

  get isEnabled(): boolean {
    return this.config.get<boolean>('ai.providers.claudeCode.enabled', false);
  }

  constructor(
    private readonly config: ConfigService,
    private readonly sandboxService: SandboxService,
    private readonly resourceProfileService: SandboxResourceProfileService,
  ) {}

  async isHealthy(): Promise<boolean> {
    return this.sandboxService.isHealthy();
  }

  async execute(payload: IAIExecutionPayload): Promise<IAIExecutionResult> {
    // Get resource limits from complexity score (OS-2.1 contract)
    const profile = this.resourceProfileService.getProfile(payload.complexityScore ?? 5);

    // Build environment — never log raw env (NFR-OS5 from SandboxService)
    const apiKey = this.config.get<string>('anthropic.apiKey', '');
    const baseURL = this.config.get<string>('anthropic.baseURL', '');
    const model = this.config.get<string>('anthropic.model', 'claude-sonnet-4-20250514');

    // Pass prompt via env var — avoids shell injection from $(), backticks, $VAR in prompt text.
    // The shell expands $CLAUDE_PROMPT safely inside double quotes without re-interpreting its value.
    const env: Record<string, string> = {
      ANTHROPIC_AUTH_TOKEN: apiKey, // Claude Code CLI uses ANTHROPIC_AUTH_TOKEN
      ANTHROPIC_MODEL: model,
      IS_SANDBOX: '1',
      CLAUDE_PROMPT: payload.prompt,
    };
    if (baseURL) {
      env['ANTHROPIC_BASE_URL'] = baseURL;
    }

    const result = await this.sandboxService.runAgentCommand({
      executionId: payload.executionId,
      image: this.config.get<string>(
        'opensandbox.agentImage',
        'opensandbox/code-interpreter:v1.0.2',
      ),
      command: 'claude "$CLAUDE_PROMPT"',
      env,
      timeoutSeconds: this.config.get<number>('opensandbox.sandboxTimeoutS', 3600),
      cpuLimit: profile.cpuLimit,
      memoryLimit: profile.memoryLimit,
      ticketId: payload.ticketId,
      metadata: {
        providerName: ProviderName.CLAUDE_CODE,
        executionId: payload.executionId,
        ticketId: payload.ticketId,
      },
    });

    const success = result.exitCode === 0 && !result.timedOut;

    return {
      success,
      codeDiff: success ? result.stdout : null,
      filesChanged: [],
      confidenceScore: success ? 0.8 : 0.0,
      durationMs: result.durationMs,
      workspacePath: '',
      ...(success
        ? {}
        : {
            error: {
              code: result.timedOut ? AIErrorCode.TIMEOUT : AIErrorCode.PROCESS_CRASH,
              message: result.stderr || 'Claude Code execution failed in sandbox',
              isRetryable: result.timedOut,
              rawOutput: `${result.stdout}\n${result.stderr}`.trim(),
              exitCode: result.exitCode,
            },
          }),
    };
  }
}
