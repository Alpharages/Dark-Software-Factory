import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'child_process';
import * as readline from 'readline';
import * as path from 'path';
import { ExecutionRepository } from '@/execution/execution.repository';
import { ExecutionTrackerService } from '@/execution/execution-tracker.service';
import { PrismaService } from '@/database/prisma.service';
import { AIProvider, Prisma } from '@/prisma/client';
import { OpenHarnessStreamParser } from './openharness-stream.parser';

/** Engine model recorded on the Execution when none is configured. */
const DEFAULT_OPENHARNESS_MODEL = 'gpt-5.4';
/** MCP config path used when MCP_CONFIG_PATH is unset (relative to the DSF root). */
const DEFAULT_MCP_CONFIG_PATH = './docs/openharness/mcp-config.json';
/** Wall-clock budget for a single `oh` run before it is killed and marked TIMEOUT. */
const RUN_TIMEOUT_MS = 1000 * 60 * 30; // 30 minutes

export interface OpenHarnessRunOptions {
  skill: string;
  workspaceDir: string;
  maxTurns?: number;
}

@Injectable()
export class OpenHarnessRunnerService {
  private readonly logger = new Logger(OpenHarnessRunnerService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly executionRepository: ExecutionRepository,
    private readonly executionTracker: ExecutionTrackerService,
    private readonly prisma: PrismaService,
  ) {}

  async runForTicket(ticketId: string, opts: OpenHarnessRunOptions): Promise<string> {
    const { skill, workspaceDir, maxTurns = 200 } = opts;
    const model = this.configService.get<string>('OPENHARNESS_MODEL') || DEFAULT_OPENHARNESS_MODEL;

    const execution = await this.executionRepository.create({
      ticketId,
      provider: AIProvider.OPENHARNESS,
      prompt: `Run OpenHarness skill: ${skill}`,
      // Single-tenant MVP: OpenHarness runs are not auto-retried. Without this,
      // ExecutionTracker.timeoutExecution() would re-queue the row to QUEUED on
      // timeout (TIMEOUT is a retryable state), leaving a non-terminal record.
      maxRetries: 0,
    });

    await this.executionTracker.markInProgress(execution.id, execution.id);

    // Record the engine model once, up-front, in a single write — avoids
    // duplicating the selected_model write across the success/failure branches.
    await this.prisma.execution.update({
      where: { id: execution.id },
      data: { selected_model: model },
    });

    // Resolve the MCP config to an ABSOLUTE path against this process's cwd
    // (the DSF root). The child is spawned with cwd = workspaceDir, so a
    // relative path would otherwise resolve under the ticket workspace and the
    // config would not be found.
    const configuredMcpPath =
      this.configService.get<string>('MCP_CONFIG_PATH') || DEFAULT_MCP_CONFIG_PATH;
    const mcpConfigPath = path.isAbsolute(configuredMcpPath)
      ? configuredMcpPath
      : path.resolve(process.cwd(), configuredMcpPath);

    return new Promise((resolve) => {
      const child = spawn(
        'oh',
        [
          '-p',
          skill,
          '--output-format',
          'stream-json',
          '--permission-mode',
          'full_auto',
          '--max-turns',
          String(maxTurns),
          '--mcp-config',
          mcpConfigPath,
        ],
        {
          cwd: workspaceDir,
          env: {
            ...process.env,
            CLICKUP_API_KEY: this.configService.get<string>('CLICKUP_API_KEY') || '',
            LORE_SLUG: this.configService.get<string>('LORE_SLUG') || '',
            LORE_KEY: this.configService.get<string>('LORE_KEY') || '',
          },
        },
      );

      const parser = new OpenHarnessStreamParser();
      let lastProgress = '';
      let settled = false;

      if (child.stdout) {
        const rl = readline.createInterface({ input: child.stdout });
        rl.on('line', (line) => {
          const event = parser.parseLine(line);
          if (event?.type === 'progress' && event.step) {
            lastProgress = event.step;
          }
        });
      }

      if (child.stderr) {
        child.stderr.on('data', (data) => {
          this.logger.debug(`[${execution.id}] STDERR: ${data.toString().trim()}`);
        });
      }

      // Run exactly one terminal path and only resolve once its persistence has
      // completed. The `settled` guard prevents a double-fire: a timeout calls
      // child.kill(), which in turn emits 'close' — without the guard the close
      // handler would attempt a second, illegal TIMEOUT→FAILED transition. It
      // also ensures the row is genuinely in its terminal state by the time
      // runForTicket() resolves, so a caller that reads the row right after the
      // await sees the final status (not a still-in-flight write).
      const finalize = (persist: () => Promise<unknown>): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        void (async () => {
          try {
            await persist();
          } catch (e) {
            this.logger.error(e);
          } finally {
            resolve(execution.id);
          }
        })();
      };

      const timer = setTimeout(() => {
        child.kill();
        finalize(() =>
          this.executionTracker.timeoutExecution(
            {
              executionId: execution.id,
              timeoutSeconds: RUN_TIMEOUT_MS / 1000,
              lastKnownProgress: lastProgress,
            },
            execution.id,
          ),
        );
      }, RUN_TIMEOUT_MS);

      child.on('error', (err) => {
        finalize(() =>
          this.executionTracker.failExecution(
            {
              executionId: execution.id,
              errorMessage: `Spawn error: ${err.message}`,
              isRetryable: false,
            },
            execution.id,
          ),
        );
      });

      child.on('close', (code) => {
        finalize(async () => {
          const result = parser.getResult();
          const filesChanged = parser.getFilesChanged();
          const toolsUsed = parser.getToolsUsed();
          const summary = result?.summary || 'Execution completed without summary';

          if (code === 0 && result && result.status !== 'FAILED') {
            await this.prisma.execution.update({
              where: { id: execution.id },
              data: {
                progress: { tools_used: toolsUsed } as Prisma.InputJsonValue,
              },
            });

            await this.executionTracker.completeExecution(
              {
                executionId: execution.id,
                codeOutput: summary,
                filesChanged: filesChanged,
                // Placeholder: IExecutionCompletion requires a confidence score,
                // but the OpenHarness stream carries no confidence signal. 1.0 is
                // a known limitation, not a measured value — revisit if the
                // stream gains a confidence field.
                confidenceScore: 1.0,
              },
              execution.id,
            );
          } else {
            let errorMessage = result?.error_message || `Process exited with code ${code}`;
            const errorContext = result?.error_context || '';
            if (!result && code === 0) {
              errorMessage = 'Clean exit but no parseable result event';
            }

            if (errorContext) {
              await this.prisma.execution.update({
                where: { id: execution.id },
                data: { error_context: errorContext },
              });
            }

            await this.executionTracker.failExecution(
              {
                executionId: execution.id,
                errorMessage,
                errorCode: String(code),
                isRetryable: false,
              },
              execution.id,
            );
          }
        });
      });
    });
  }
}
