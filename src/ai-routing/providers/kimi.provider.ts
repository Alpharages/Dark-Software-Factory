import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ICodingAgentProvider } from '../interfaces/coding-agent-provider.interface';
import { ProviderName } from '@/ai-routing/enums/provider-name.enum';
import { IAIExecutionPayload } from '@/execution/interfaces';
import { IAIExecutionResult, AIErrorCode } from '../interfaces/ai-provider.interface';
import { SandboxService } from '@/sandbox/sandbox.service';
import { SandboxResourceProfileService } from '@/sandbox/sandbox-resource-profile.service';

/**
 * Kimi CLI Provider
 * Executes the `kimi` command in an OpenSandbox container.
 * Part of Story OS-4.3
 */
@Injectable()
export class KimiProvider implements ICodingAgentProvider {
  readonly providerName = ProviderName.KIMI;

  get isEnabled(): boolean {
    return this.config.get<boolean>('ai.providers.kimi.enabled', false);
  }

  constructor(
    private readonly config: ConfigService,
    private readonly sandboxService: SandboxService,
    private readonly resourceProfileService: SandboxResourceProfileService,
  ) {}

  async isHealthy(): Promise<boolean> {
    const apiKey = this.config.get<string>('kimi.apiKey', '');
    if (!apiKey) return false;
    return this.sandboxService.isHealthy();
  }

  async execute(payload: IAIExecutionPayload): Promise<IAIExecutionResult> {
    // Get resource limits from complexity score (OS-2.1 contract)
    const profile = this.resourceProfileService.getProfile(payload.complexityScore ?? 5);

    // Build environment — never log raw env (NFR-OS5 from SandboxService)
    const apiKey = this.config.get<string>('kimi.apiKey', '');
    const baseURL = this.config.get<string>('kimi.baseURL', '');
    const model = this.config.get<string>('kimi.model', 'kimi-k2');

    // Pass prompt via env var — avoids shell injection from $(), backticks, $VAR in prompt text.
    // The shell expands $KIMI_PROMPT safely inside double quotes without re-interpreting its value.
    const env: Record<string, string> = {
      KIMI_API_KEY: apiKey,
      KIMI_MODEL: model,
      KIMI_PROMPT: payload.prompt,
    };
    if (baseURL) {
      env['KIMI_BASE_URL'] = baseURL;
    }

    const result = await this.sandboxService.runAgentCommand({
      executionId: payload.executionId,
      image: this.config.get<string>(
        'opensandbox.agentImage',
        'opensandbox/code-interpreter:v1.0.2',
      ),
      command: 'kimi "$KIMI_PROMPT"',
      env,
      timeoutSeconds: this.config.get<number>('opensandbox.sandboxTimeoutS', 3600),
      cpuLimit: profile.cpuLimit,
      memoryLimit: profile.memoryLimit,
      ticketId: payload.ticketId,
      metadata: {
        providerName: ProviderName.KIMI,
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
              message: result.stderr || 'Kimi execution failed in sandbox',
              isRetryable: result.timedOut,
              rawOutput: `${result.stdout}\n${result.stderr}`.trim(),
              exitCode: result.exitCode,
            },
          }),
    };
  }
}
