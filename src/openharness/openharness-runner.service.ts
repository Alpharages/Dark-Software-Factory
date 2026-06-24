import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn, execFileSync } from 'child_process';
import * as readline from 'readline';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { ExecutionRepository } from '@/execution/execution.repository';
import { ExecutionTrackerService } from '@/execution/execution-tracker.service';
import { PrismaService } from '@/database/prisma.service';
import { AIProvider, Prisma } from '@/prisma/client';
import { openHarnessSkillPrompt } from './skills.enum';
import { OpenHarnessStreamParser } from './openharness-stream.parser';
import { isOpenHarnessLiveEvent, OpenHarnessStreamEvent } from './stream/openharness-event.types';
import { OpenHarnessStreamAdapter } from './stream/openharness-stream.adapter';
import { OpenHarnessRunGuardrailsService } from './run-guardrails.service';

type MandatedToolsMode = 'warn' | 'fail';
/**
 * Structural stream event types the runner consumes via parser state
 * (getResult/getFilesChanged/getToolsUsed) rather than the live adapter path.
 * Anything outside this set and the live-event set is logged and skipped (AC5).
 */
const KNOWN_OH_EVENT_TYPES = new Set<string>([
  'progress',
  'result',
  'qa_attempt',
  'assistant',
  'error',
]);

export interface OpenHarnessRunOptions {
  skill: string;
  workspaceDir: string;
  maxTurns?: number;
  mcpConfigPath?: string;
}

@Injectable()
export class OpenHarnessRunnerService {
  private readonly logger = new Logger(OpenHarnessRunnerService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly executionRepository: ExecutionRepository,
    private readonly executionTracker: ExecutionTrackerService,
    private readonly prisma: PrismaService,
    private readonly guardrails: OpenHarnessRunGuardrailsService,
    @Optional()
    private readonly streamAdapter?: OpenHarnessStreamAdapter,
  ) {}

  async runForTicket(ticketId: string, opts: OpenHarnessRunOptions): Promise<string> {
    const { skill, workspaceDir } = opts;
    // Single source of truth for the default: the validated `openharness.maxTurns`
    // config (Joi-bounded 1–1000, default 200). The trailing literal is only a
    // defensive fallback if config is somehow unset on a direct (non-HTTP) call.
    const maxTurns = opts.maxTurns ?? this.configService.get<number>('openharness.maxTurns') ?? 200;
    const runTimeoutMs =
      this.configService.get<number>('openharness.runTimeoutMs') ?? 1000 * 60 * 30;
    const mandatedMcpServers =
      this.configService.get<string[]>('openharness.mandatedMcpServers') ?? [];
    const mandatedToolsMode =
      this.configService.get<MandatedToolsMode>('openharness.mandatedToolsMode') ?? 'warn';
    const formatEnabled = this.configService.get<boolean>('openharness.formatEnabled') ?? true;
    const formatCommand =
      this.configService.get<string>('openharness.formatCommand') ?? 'pnpm exec prettier --write';
    const model = this.requiredConfig('openharness.model');
    const binaryPath = this.requiredConfig('openharness.binaryPath');
    // Agent runtime selector. 'claude' spawns the first-party Claude Code wrapper
    // (legitimately on the Claude subscription's plan limits); anything else keeps
    // the default OpenHarness path unchanged.
    const runtime = this.configService.get<string>('openharness.runtime') ?? 'oh';
    const claudeModel = this.configService.get<string>('openharness.claudeModel') ?? 'sonnet';
    const isolateWorkspace =
      this.configService.get<boolean>('openharness.isolateWorkspace') ?? false;
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { clickup_task_id: true },
    });
    const clickUpTaskId = ticket?.clickup_task_id ?? ticketId;
    const childPrompt = `Execute the bmad workflow ${skill} for ClickUp ticket ${clickUpTaskId} by calling bmad({operation:"execute", workflow:"${skill}", message:"${clickUpTaskId}"}).`;

    const execution = await this.executionRepository.create({
      ticketId,
      provider: AIProvider.OPENHARNESS,
      prompt: openHarnessSkillPrompt(skill),
      // Single-tenant MVP: OpenHarness runs are not auto-retried. Without this,
      // ExecutionTracker.timeoutExecution() would re-queue the row to QUEUED on
      // timeout (TIMEOUT is a retryable state), leaving a non-terminal record.
      maxRetries: 0,
    });

    await this.executionTracker.markInProgress(execution.id, execution.id);

    // Record the engine model once, up-front, in a single write — avoids
    // duplicating the selected_model write across the success/failure branches.
    // The claude runtime runs a different model than the oh `model` config.
    await this.prisma.execution.update({
      where: { id: execution.id },
      data: { selected_model: runtime === 'claude' ? claudeModel : model },
    });

    // Resolve the MCP config to an ABSOLUTE path against this process's cwd
    // (the DSF root). The child is spawned with cwd = workspaceDir, so a
    // relative path would otherwise resolve under the ticket workspace and the
    // config would not be found.
    const configuredMcpPath =
      opts.mcpConfigPath || this.requiredConfig('openharness.mcpConfigPath');
    const mcpConfigPath = path.isAbsolute(configuredMcpPath)
      ? configuredMcpPath
      : path.resolve(process.cwd(), configuredMcpPath);

    const missingMandatedTools = this.guardrails.findMissingMandatedMcpServers(
      mcpConfigPath,
      mandatedMcpServers,
    );
    if (missingMandatedTools.length > 0) {
      const message = `Missing mandated MCP servers: ${missingMandatedTools.join(', ')}`;
      await this.prisma.execution.update({
        where: { id: execution.id },
        data: {
          error_context: JSON.stringify({
            guardrails: { missingMandatedTools, mandatedToolsMode },
          }),
        },
      });

      if (mandatedToolsMode === 'fail') {
        await this.executionTracker.failExecution(
          { executionId: execution.id, errorMessage: message, isRetryable: false },
          execution.id,
        );
        return execution.id;
      }

      this.logger.warn(`[${execution.id}] ${message}`);
    }

    // Provision an isolated worktree so the agent never mutates the live working
    // tree. If isolation is requested but fails, fail closed rather than running
    // in-place against the repo (the unsafe behaviour OHP-2.6 flagged).
    let runWorkspaceDir = workspaceDir;
    if (isolateWorkspace) {
      try {
        // Persistent per-ticket branch: every leg of a ticket's loop shares one
        // branch, so a prior leg's commit is visible to the next (review/QA see
        // the implement diff). The worktree is per-run and torn down each leg;
        // the branch survives in the object store. Resolves OHP-2.6 Finding 3.
        const ticketBranch = `ohp/${clickUpTaskId}`;
        runWorkspaceDir = this.provisionWorktree(workspaceDir, execution.id, ticketBranch);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.executionTracker.failExecution(
          {
            executionId: execution.id,
            errorMessage: `Workspace isolation failed: ${message}`,
            isRetryable: false,
          },
          execution.id,
        );
        return execution.id;
      }
    }

    return new Promise((resolve) => {
      const wrapperFile =
        runtime === 'claude' ? 'scripts/claude-run-skill.sh' : 'scripts/oh-run-skill.sh';
      const wrapperPath = path.resolve(process.cwd(), wrapperFile);
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const useWrapper = fs.existsSync(wrapperPath);
      const child = spawn(
        useWrapper ? wrapperPath : binaryPath,
        useWrapper
          ? [clickUpTaskId, path.join(os.tmpdir(), `${execution.id}.stream.json`)]
          : [
              '-p',
              childPrompt,
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
          cwd: runWorkspaceDir,
          env: {
            ...process.env,
            CLICKUP_API_KEY:
              this.configService.get<string>('CLICKUP_API_KEY') ||
              process.env.CLICKUP_API_KEY ||
              '',
            CLICKUP_TEAM_ID:
              this.configService.get<string>('CLICKUP_TEAM_ID') ||
              process.env.CLICKUP_TEAM_ID ||
              '',
            BMAD_SERVER_URL:
              this.configService.get<string>('BMAD_SERVER_URL') ||
              process.env.BMAD_SERVER_URL ||
              '',
            BMAD_API_KEY:
              this.configService.get<string>('BMAD_API_KEY') || process.env.BMAD_API_KEY || '',
            LORE_SERVER_URL:
              this.configService.get<string>('LORE_SERVER_URL') ||
              process.env.LORE_SERVER_URL ||
              '',
            LORE_API_KEY:
              this.configService.get<string>('LORE_API_KEY') || process.env.LORE_API_KEY || '',
            LORE_SLUG: this.configService.get<string>('LORE_SLUG') || process.env.LORE_SLUG || '',
            LORE_KEY: this.configService.get<string>('LORE_KEY') || process.env.LORE_KEY || '',
            OH_RUN_WORKFLOW: skill,
            OH_RUN_MCP_CONFIG: mcpConfigPath,
            OH_RUN_MODEL: model,
            // Consumed only by scripts/claude-run-skill.sh (runtime === 'claude').
            CLAUDE_RUN_MODEL: claudeModel,
            OH_RUN_MAX_TURNS: String(maxTurns),
            OH_RUN_STREAM_STDOUT: useWrapper ? '1' : '',
            ...(useWrapper
              ? {}
              : {
                  OPENHARNESS_CONFIG_DIR: path.join(
                    os.tmpdir(),
                    `${execution.id}-openharness-config`,
                  ),
                }),
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
          if (!event) return;

          if (event.type === 'progress' && event.step) {
            lastProgress = event.step;
          }

          if (isOpenHarnessLiveEvent(event as OpenHarnessStreamEvent)) {
            this.streamAdapter
              ?.handleEvent(execution.id, ticketId, event)
              .catch((error: unknown) => {
                const message = error instanceof Error ? error.message : String(error);
                this.logger.warn(`[${execution.id}] OpenHarness stream adapter failed: ${message}`);
              });
            return;
          }

          // AC5: unknown/unhandled stream event types are logged and skipped so
          // they are observable without ever crashing the run.
          if (!KNOWN_OH_EVENT_TYPES.has(event.type)) {
            this.logger.debug(
              `[${execution.id}] Skipping unrecognized OpenHarness stream event: ${event.type}`,
            );
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
            // Tear down the isolated worktree on every terminal path (success,
            // failure, timeout). Best-effort: never block resolution on cleanup.
            if (isolateWorkspace && runWorkspaceDir !== workspaceDir) {
              this.removeWorktree(workspaceDir, runWorkspaceDir);
            }
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
              timeoutSeconds: runTimeoutMs / 1000,
              lastKnownProgress: lastProgress,
            },
            execution.id,
          ),
        );
      }, runTimeoutMs);

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
            try {
              await this.guardrails.formatOwnFiles(
                runWorkspaceDir,
                filesChanged,
                formatEnabled,
                formatCommand,
              );
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              await this.prisma.execution.update({
                where: { id: execution.id },
                data: { error_context: `OpenHarness guardrail formatter failed: ${message}` },
              });
              await this.executionTracker.failExecution(
                {
                  executionId: execution.id,
                  errorMessage: `OpenHarness guardrail formatter failed: ${message}`,
                  isRetryable: false,
                },
                execution.id,
              );
              return;
            }

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

  private requiredConfig(key: string): string {
    const value = this.configService.get<string>(key);
    if (!value) {
      throw new Error(`Missing OpenHarness configuration: ${key}`);
    }
    return value;
  }

  /**
   * Create a per-run git worktree under a temp path, checked out on the shared
   * per-ticket `branch`. The worktree is a clean checkout that shares `repoDir`'s
   * object store, so the agent can commit without touching the live working tree.
   * The branch persists across legs (created from HEAD on first use, reused
   * thereafter) so each leg sees prior legs' commits. `node_modules` is symlinked
   * so the agent can run tests/typecheck. Returns the worktree path.
   */
  private provisionWorktree(repoDir: string, executionId: string, branch: string): string {
    const dir = path.join(os.tmpdir(), 'dsf-workspaces', executionId);
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    // Drop registrations for worktrees whose dirs were already removed.
    try {
      execFileSync('git', ['-C', repoDir, 'worktree', 'prune'], { stdio: 'pipe' });
    } catch {
      /* ignore */
    }
    const branchExists = ((): boolean => {
      try {
        execFileSync(
          'git',
          ['-C', repoDir, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`],
          {
            stdio: 'pipe',
          },
        );
        return true;
      } catch {
        return false;
      }
    })();
    if (branchExists) {
      // Reuse the persistent branch so prior legs' commits are visible.
      execFileSync('git', ['-C', repoDir, 'worktree', 'add', dir, branch], { stdio: 'pipe' });
    } else {
      const head = execFileSync('git', ['-C', repoDir, 'rev-parse', 'HEAD'], {
        encoding: 'utf8',
      }).trim();
      execFileSync('git', ['-C', repoDir, 'worktree', 'add', '-b', branch, dir, head], {
        stdio: 'pipe',
      });
    }
    // Make the worktree a runnable dev env (tests/typecheck) by sharing node_modules.
    const nodeModules = path.join(repoDir, 'node_modules');
    const worktreeNodeModules = path.join(dir, 'node_modules');
    if (
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      fs.existsSync(nodeModules) &&
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      !fs.existsSync(worktreeNodeModules)
    ) {
      try {
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        fs.symlinkSync(nodeModules, worktreeNodeModules, 'dir');
      } catch {
        /* ignore — tests may be blocked but AC file checks still work */
      }
    }
    this.logger.log(`[${executionId}] Provisioned isolated worktree at ${dir} (branch ${branch})`);
    return dir;
  }

  /** Remove a worktree created by {@link provisionWorktree}. Best-effort. */
  private removeWorktree(repoDir: string, worktreeDir: string): void {
    try {
      execFileSync('git', ['-C', repoDir, 'worktree', 'remove', '--force', worktreeDir], {
        stdio: 'pipe',
      });
    } catch {
      // Fall back to pruning the registration and removing the directory.
      try {
        execFileSync('git', ['-C', repoDir, 'worktree', 'prune'], { stdio: 'pipe' });
      } catch {
        /* ignore */
      }
      try {
        fs.rmSync(worktreeDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
}
