import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SandboxManager, SandboxInfo } from '@alibaba-group/opensandbox';
import { AgentCommandOptions } from './interfaces/agent-command-options.interface';
import { AgentCommandResult } from './interfaces/agent-command-result.interface';

@Injectable()
export class SandboxService implements OnModuleInit {
  private readonly logger = new Logger(SandboxService.name);
  private manager!: SandboxManager;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const domain = this.config.get<string>('opensandbox.domain', 'localhost:8080');

    this.manager = SandboxManager.create({
      connectionConfig: {
        domain,
        apiKey: this.config.get<string>('opensandbox.apiKey', ''),
        protocol: this.config.get<'http' | 'https'>('opensandbox.protocol', 'http'),
        requestTimeoutSeconds: Math.floor(
          this.config.get<number>('opensandbox.requestTimeoutMs', 60000) / 1000,
        ),
      },
    });

    const isProd = process.env.NODE_ENV === 'production';

    try {
      await this.pingServer();
      this.logger.log(`OpenSandbox connected successfully at ${domain}`);
    } catch (err) {
      const message =
        `SandboxService: OpenSandbox server unreachable at ${domain}. ` +
        `Set OPENSANDBOX_DOMAIN to point to a running opensandbox-server. ` +
        `Error: ${(err as Error).message}`;

      if (isProd) {
        throw new Error(message);
      } else {
        this.logger.warn(message);
      }
    }
  }

  /** Used by onModuleInit and isHealthy(). Throws on failure. */
  private async pingServer(): Promise<void> {
    await Promise.race([
      this.manager.listSandboxInfos({ pageSize: 1 }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('OpenSandbox health ping timed out after 10s')), 10_000),
      ),
    ]);
  }

  /** Called by providers (e.g. ClaudeCodeProvider.isHealthy()) to check connectivity. Never throws. */
  async isHealthy(): Promise<boolean> {
    try {
      await this.pingServer();
      return true;
    } catch {
      return false;
    }
  }

  async getSandboxInfo(sandboxId: string): Promise<SandboxInfo> {
    return this.manager.getSandboxInfo(sandboxId);
  }

  async killSandbox(sandboxId: string): Promise<void> {
    return this.manager.killSandbox(sandboxId);
  }

  async listActiveSandboxes(): Promise<SandboxInfo[]> {
    const response = await this.manager.listSandboxInfos();
    return response.items || [];
  }

  async runAgentCommand(_options: AgentCommandOptions): Promise<AgentCommandResult> {
    throw new Error('[OS-1.3] runAgentCommand not yet implemented — awaiting streaming support');
  }
}
