import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ICodingAgentProvider } from '../interfaces/coding-agent-provider.interface';
import { ProviderName } from '@/ai-routing/enums/provider-name.enum';
import { IAIExecutionPayload } from '@/execution/interfaces';
import { IAIExecutionResult, AIErrorCode } from '../interfaces/ai-provider.interface';
import { SandboxService } from '@/sandbox/sandbox.service';
import { SandboxResourceProfileService } from '@/sandbox/sandbox-resource-profile.service';

/**
 * OpenAI Codex CLI Provider
 * Executes the `codex` command in an OpenSandbox container.
 * Part of Story OS-4.3
 */
@Injectable()
export class CodexProvider implements ICodingAgentProvider {
  readonly providerName = ProviderName.CODEX;

  get isEnabled(): boolean {
    return this.config.get<boolean>('ai.providers.codex.enabled', false);
  }

  constructor(
    private readonly config: ConfigService,
    private readonly sandboxService: SandboxService,
    private readonly resourceProfileService: SandboxResourceProfileService,
  ) {}

  async isHealthy(): Promise<boolean> {
    const apiKey = this.config.get<string>('codex.apiKey', '');
    if (!apiKey) return false;
    return this.sandboxService.isHealthy();
  }

  async execute(payload: IAIExecutionPayload): Promise<IAIExecutionResult> {
    // Get resource limits from complexity score (OS-2.1 contract)
    const profile = this.resourceProfileService.getProfile(payload.complexityScore ?? 5);

    // Build environment — never log raw env (NFR-OS5 from SandboxService)
    const apiKey = this.config.get<string>('codex.apiKey', '');
    const baseURL = this.config.get<string>('codex.baseURL', '');
    const model = this.config.get<string>('codex.model', 'codex-1');

    // Pass prompt via env var — avoids shell injection from $(), backticks, $VAR in prompt text.
    // The shell expands $CODEX_PROMPT safely inside double quotes without re-interpreting its value.
    const env: Record<string, string> = {
      OPENAI_API_KEY: apiKey,
      CODEX_MODEL: model,
      CODEX_PROMPT: payload.prompt,
    };
    if (baseURL) {
      env['OPENAI_BASE_URL'] = baseURL;
    }

    const result = await this.sandboxService.runAgentCommand({
      executionId: payload.executionId,
      image: this.config.get<string>(
        'opensandbox.agentImage',
        'opensandbox/code-interpreter:v1.0.2',
      ),
      command: 'codex "$CODEX_PROMPT"',
      env,
      timeoutSeconds: this.config.get<number>('opensandbox.sandboxTimeoutS', 3600),
      cpuLimit: profile.cpuLimit,
      memoryLimit: profile.memoryLimit,
      ticketId: payload.ticketId,
      metadata: {
        providerName: ProviderName.CODEX,
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
              message: result.stderr || 'Codex execution failed in sandbox',
              isRetryable: result.timedOut,
              rawOutput: `${result.stdout}\n${result.stderr}`.trim(),
              exitCode: result.exitCode,
            },
          }),
    };
  }
}
