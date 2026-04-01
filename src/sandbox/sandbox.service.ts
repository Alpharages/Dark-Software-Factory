import { Injectable, OnModuleInit, Logger, Optional, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { Counter, Histogram, Gauge } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import {
  SandboxManager,
  SandboxInfo,
  Sandbox,
  ConnectionConfigOptions,
  OutputMessage,
} from '@alibaba-group/opensandbox';
import { AgentCommandOptions } from './interfaces/agent-command-options.interface';
import { AgentCommandResult } from './interfaces/agent-command-result.interface';
import { ExecutionGateway } from '@/execution/gateways/execution.gateway';
import { Semaphore } from '@/common/utils/semaphore.util';
import { SANDBOX_METRICS } from '@/common/metrics/metrics.constants';

@Injectable()
export class SandboxService implements OnModuleInit {
  private readonly logger = new Logger(SandboxService.name);
  private manager!: SandboxManager;
  private connectionConfigOptions!: ConnectionConfigOptions;
  private semaphore!: Semaphore;
  private maxConcurrent = 10;

  constructor(
    private readonly config: ConfigService,
    @Optional()
    @Inject(forwardRef(() => ExecutionGateway))
    private readonly executionGateway: ExecutionGateway | null,
    @InjectMetric(SANDBOX_METRICS.EXECUTIONS_TOTAL)
    private readonly executionsCounter: Counter<string>,
    @InjectMetric(SANDBOX_METRICS.EXECUTION_DURATION_SECONDS)
    private readonly durationHistogram: Histogram<string>,
    @InjectMetric(SANDBOX_METRICS.ACTIVE_SANDBOXES)
    private readonly activeSandboxesGauge: Gauge<string>,
    @InjectMetric(SANDBOX_METRICS.CONCURRENCY_QUEUE_DEPTH)
    private readonly queueDepthGauge: Gauge<string>,
  ) {}

  async onModuleInit(): Promise<void> {
    const domain = this.config.get<string>('opensandbox.domain', 'localhost:8080');

    this.connectionConfigOptions = {
      domain,
      apiKey: this.config.get<string>('opensandbox.apiKey', ''),
      protocol: this.config.get<'http' | 'https'>('opensandbox.protocol', 'http'),
      requestTimeoutSeconds: Math.floor(
        this.config.get<number>('opensandbox.requestTimeoutMs', 60000) / 1000,
      ),
      useServerProxy: this.config.get<boolean>('opensandbox.useServerProxy', false),
    };

    this.manager = SandboxManager.create({
      connectionConfig: this.connectionConfigOptions,
    });

    this.maxConcurrent = this.config.get<number>('opensandbox.maxConcurrent', 10);
    this.semaphore = new Semaphore(this.maxConcurrent);
    this.logger.log(`SandboxService: concurrency limit set to ${this.maxConcurrent}`);

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
    let timeoutId: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error('OpenSandbox health ping timed out after 10s'));
      }, 10_000);
    });

    try {
      await Promise.race([this.manager.listSandboxInfos({ pageSize: 1 }), timeoutPromise]);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
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

  async runAgentCommand(options: AgentCommandOptions): Promise<AgentCommandResult> {
    if (!this.manager) {
      throw new Error(
        'SandboxService.runAgentCommand() called before onModuleInit() completed. ' +
          'Ensure SandboxModule is initialized before calling runAgentCommand().',
      );
    }

    const providerName = options.metadata?.providerName ?? 'unknown';

    // NFR-OS4: Enforce concurrency limit — queue if at max, never reject
    const queueLength = this.semaphore.getQueueLength();
    const availablePermits = this.semaphore.getAvailablePermits();

    if (availablePermits === 0) {
      this.logger.warn(
        `SandboxService: concurrency limit reached (max=${this.maxConcurrent}), ` +
          `queuing execution executionId=${options.executionId}, ` +
          `provider=${providerName}, queue depth=${queueLength + 1}`,
      );
    }

    // Update queue depth gauge before acquiring (reflects waiting callers)
    this.queueDepthGauge.set(queueLength + (availablePermits === 0 ? 1 : 0));

    await this.semaphore.acquire();

    // Reset queue depth after slot acquired (one less waiter)
    this.queueDepthGauge.set(this.semaphore.getQueueLength());

    const startTime = Date.now();
    let executionStatus: 'success' | 'failed' | 'timeout' = 'success';

    // NFR-OS5: Redact API keys from logs — NEVER log raw env
    this.logger.debug(
      `Starting sandbox execution: executionId=${options.executionId}, ` +
        `image=${options.image}, provider=${providerName}, ` +
        `env=${JSON.stringify(this.redactEnvForLogging(options.env))}`,
    );

    let sandbox: Sandbox | null = null;
    let sandboxId: string | null = null;
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let lineBuffer = '';
    let timedOut = false;
    let exitCode = 1;

    try {
      sandbox = await Sandbox.create({
        image: options.image,
        env: options.env,
        resource: {
          cpu: options.cpuLimit,
          memory: options.memoryLimit,
        },
        networkPolicy: options.networkPolicy
          ? {
              defaultAction: options.networkPolicy.defaultAction.toLowerCase() as 'allow' | 'deny',
              egress: options.networkPolicy.egressRules?.map((r) => ({
                action: 'allow' as const,
                target: r.target,
              })),
            }
          : undefined,
        metadata: options.metadata,
        connectionConfig: this.connectionConfigOptions,
        readyTimeoutSeconds: this.config.get<number>('opensandbox.readyTimeoutS', 120),
      });

      sandboxId = sandbox.id;

      this.logger.debug(
        `Sandbox created: sandboxId=${sandboxId}, executionId=${options.executionId}`,
      );

      const execResult = await sandbox.commands.run(
        options.command,
        {
          timeoutSeconds: options.timeoutSeconds,
        },
        {
          onStdout: (msg: OutputMessage) => {
            stdoutBuffer += msg.text;
            this.executionGateway?.emitLog(
              options.executionId,
              options.ticketId ?? '',
              msg.text,
              'stdout',
            );

            if (options.onStdoutLine) {
              lineBuffer += msg.text;
              const lines = lineBuffer.split('\n');
              lineBuffer = lines.pop() || '';

              for (const line of lines) {
                try {
                  options.onStdoutLine(line);
                } catch (err) {
                  // NFR-WR4: Swallowing errors to prevent sandbox execution crash — never let callback crash the loop
                  this.logger.error(
                    `[SandboxService] Error in onStdoutLine callback for ${options.executionId}: ${(err as Error).message}`,
                    (err as Error).stack,
                  );
                }
              }
            }
          },
          onStderr: (msg: OutputMessage) => {
            stderrBuffer += msg.text;
            this.executionGateway?.emitLog(
              options.executionId,
              options.ticketId ?? '',
              msg.text,
              'stderr',
            );
          },
        },
      );

      // Infer exit code from the execResult
      exitCode = execResult.error ? 1 : 0;
      timedOut =
        execResult.error?.name === 'TimeoutError' ||
        /timed? out|timeout/i.test(execResult.error?.value ?? '');

      const durationMs = Date.now() - startTime;
      const durationSeconds = durationMs / 1000;
      executionStatus = timedOut ? 'timeout' : 'success';

      this.executionsCounter.inc({ provider: providerName, status: executionStatus });
      this.durationHistogram.observe({ provider: providerName }, durationSeconds);

      // NFR-OS9: Log execution summary — NEVER log stdout/stderr content
      this.logger.log(
        `Sandbox execution complete: sandboxId=${sandboxId}, ` +
          `executionId=${options.executionId}, providerName=${providerName}, ` +
          `durationMs=${durationMs}, exitCode=${exitCode}, ` +
          `timedOut=${timedOut}, ` +
          `stdoutBytes=${Buffer.byteLength(stdoutBuffer)}, ` +
          `stderrBytes=${Buffer.byteLength(stderrBuffer)}`,
      );

      return {
        sandboxId,
        stdout: stdoutBuffer,
        stderr: stderrBuffer,
        exitCode,
        durationMs,
        timedOut,
      };
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const durationSeconds = durationMs / 1000;
      const error = err as Error;
      const message = error.message ?? '';

      // Check both error class name (consistent with happy-path TimeoutError detection) AND message regex
      timedOut =
        error.name === 'TimeoutError' ||
        error.constructor?.name === 'TimeoutError' ||
        /timed? out|timeout/i.test(message);

      executionStatus = timedOut ? 'timeout' : 'failed';
      this.executionsCounter.inc({ provider: providerName, status: executionStatus });
      this.durationHistogram.observe({ provider: providerName }, durationSeconds);

      this.logger.error(
        `Sandbox execution failed: executionId=${options.executionId}, ` +
          `sandboxId=${sandboxId ?? 'N/A'}, ` +
          `providerName=${providerName}, durationMs=${durationMs}, ` +
          `timedOut=${timedOut}, error=${message}`,
      );

      throw err;
    } finally {
      // NFR-OS2: Always kill AND close
      if (sandbox) {
        try {
          await sandbox.kill();
        } catch (killErr) {
          this.logger.warn(
            `Failed to kill sandbox (executionId=${options.executionId}): ` +
              `${(killErr as Error).message}`,
          );
        }
        try {
          await sandbox.close();
        } catch (closeErr) {
          this.logger.warn(
            `Failed to close sandbox (executionId=${options.executionId}): ` +
              `${(closeErr as Error).message}`,
          );
        }
      }
      this.semaphore.release();
      this.queueDepthGauge.set(this.semaphore.getQueueLength());
    }
  }

  /**
   * NFR-OS3: Background leak prevention — runs every 5 minutes.
   * Kills any sandbox running longer than OPENSANDBOX_SANDBOX_TIMEOUT_S * 1.5 seconds.
   * Also updates the active sandboxes Prometheus gauge.
   */
  @Cron('0 */5 * * * *')
  async checkForLeakedSandboxes(): Promise<void> {
    this.logger.debug('SandboxService: running leak prevention check');

    if (!this.manager) {
      this.logger.debug('SandboxService: manager not initialized, skipping leak check');
      return;
    }

    try {
      const activeSandboxes = await this.listActiveSandboxes();
      this.activeSandboxesGauge.set(activeSandboxes.length);

      const sandboxTimeoutS = this.config.get<number>('opensandbox.sandboxTimeoutS', 3600) ?? 3600;
      const timeoutThresholdMs = sandboxTimeoutS * 1.5 * 1000;

      const now = Date.now();
      let killedCount = 0;

      for (const sandbox of activeSandboxes) {
        // NFR-OS3: Check sandbox age. Verified SDK field: createdAt (Date)
        if (!sandbox.createdAt) {
          this.logger.warn(
            `SandboxService: skipping sandbox sandboxId=${sandbox.id} — createdAt field missing from SDK response`,
          );
          continue;
        }
        const startedAt = new Date(sandbox.createdAt).getTime();
        const ageMs = now - startedAt;

        if (ageMs > timeoutThresholdMs) {
          this.logger.warn(
            `SandboxService: killing leaked sandbox sandboxId=${sandbox.id}, ` +
              `ageMs=${ageMs}, threshold=${timeoutThresholdMs}`,
          );
          try {
            await this.killSandbox(sandbox.id);
            killedCount++;
          } catch (killErr) {
            this.logger.warn(
              `SandboxService: failed to kill leaked sandbox sandboxId=${sandbox.id}: ` +
                `${(killErr as Error).message}`,
            );
          }
        }
      }

      if (killedCount > 0) {
        this.logger.log(`SandboxService: leak prevention killed ${killedCount} sandbox(es)`);
        // Update gauge after kills
        const remaining = await this.listActiveSandboxes();
        this.activeSandboxesGauge.set(remaining.length);
      }
    } catch (err) {
      this.logger.error(`SandboxService: leak prevention check failed: ${(err as Error).message}`);
    }
  }

  /** NFR-OS5: Redact sensitive values from env before logging */
  private redactEnvForLogging(env?: Record<string, string>): Record<string, string> {
    if (!env) return {};
    const SENSITIVE = /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH/i;
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) {
      // eslint-disable-next-line security/detect-object-injection
      result[key] = SENSITIVE.test(key) ? '[REDACTED]' : value;
    }
    return result;
  }
}
