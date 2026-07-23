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
import { AIProvider, DependencyEdgeType, ExecutionStatus, Prisma } from '@/prisma/client';
import { OpenHarnessSkill, openHarnessSkillPrompt } from './skills.enum';
import { OpenHarnessStreamParser } from './openharness-stream.parser';
import { isOpenHarnessLiveEvent, OpenHarnessStreamEvent } from './stream/openharness-event.types';
import { OpenHarnessStreamAdapter } from './stream/openharness-stream.adapter';
import { OpenHarnessRunGuardrailsService } from './run-guardrails.service';
import { ProjectWorkspaceService } from './project-workspace.service';
import { SkillModelMapService } from './skill-model-map.service';
import { OpenHarnessCodeReadyEvent } from './events/openharness-code-ready.event';
import { OpenHarnessNeedsInputEvent } from './events/openharness-needs-input.event';
import { EventBusService } from '@/common/event-bus.service';
import { AiAccountsService } from '@/ai-accounts/ai-accounts.service';
import { AiAccountSelectorService } from '@/ai-accounts/account-selector.service';
import { NoEligibleAccountError } from '@/ai-accounts/errors/no-eligible-account.error';
import { AICostTrackerService } from '@/cost-tracking/ai-cost-tracker.service';
import { EncryptionService } from '@/common/encryption/encryption.service';

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
    private readonly projectWorkspace: ProjectWorkspaceService,
    private readonly eventBus: EventBusService,
    private readonly skillModelMap: SkillModelMapService,
    private readonly accountSelector: AiAccountSelectorService,
    private readonly aiAccounts: AiAccountsService,
    private readonly costTracker: AICostTrackerService,
    private readonly encryption: EncryptionService,
    @Optional()
    private readonly streamAdapter?: OpenHarnessStreamAdapter,
  ) {}

  /**
   * Per-project Lore credentials for multi-tenant isolation: each DSF project maps
   * to its own Lore project, so lessons/patterns never mix across concurrent runs.
   * Isolation is the bearer token alone — Lore's Postgres RLS scopes every query to
   * it — so the MCP server name stays the static `lore` and no config regen is
   * needed. A project with no key inherits the global LORE_* env (single-tenant /
   * not-yet-provisioned, unchanged behaviour).
   */
  private async resolveLoreEnv(
    projectId?: string,
  ): Promise<{ LORE_SERVER_URL: string; LORE_API_KEY: string }> {
    const globalUrl =
      this.configService.get<string>('LORE_SERVER_URL') || process.env.LORE_SERVER_URL || '';
    const globalKey =
      this.configService.get<string>('LORE_API_KEY') || process.env.LORE_API_KEY || '';
    if (!projectId) return { LORE_SERVER_URL: globalUrl, LORE_API_KEY: globalKey };

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { lore_server_url: true, lore_api_key: true },
    });
    if (!project?.lore_api_key) {
      return { LORE_SERVER_URL: globalUrl, LORE_API_KEY: globalKey };
    }
    try {
      return {
        LORE_SERVER_URL: project.lore_server_url || globalUrl,
        LORE_API_KEY: this.encryption.decrypt(project.lore_api_key),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[lore] project ${projectId} key failed to decrypt (${message}); running without Lore to avoid cross-tenant leakage`,
      );
      // ponytail: empty token → Lore MCP 401s and its tools drop out for this run;
      // safer than falling back to the shared global key, which would mix memory.
      return { LORE_SERVER_URL: project.lore_server_url || globalUrl, LORE_API_KEY: '' };
    }
  }

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
    const binaryPath = this.requiredConfig('openharness.binaryPath');
    // Model + agent runtime are resolved from the global skill→model map (A3),
    // falling back to static config when the map has no entry for this skill.
    // 'claude' runtime spawns the first-party Claude Code wrapper (legitimately
    // on the Claude subscription's plan limits); anything else keeps the
    // default OpenHarness path unchanged.
    const { model, provider, runtime } = await this.skillModelMap.resolveModel(skill);
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

    let selectedAccountId = '';
    let accountEnv: Record<string, string> = {};
    try {
      const account = await this.accountSelector.selectAccount({ provider, runtime, model });
      const credentials = await this.aiAccounts.getDecryptedCredentials(account.id);
      if (provider === 'openai') {
        const token = credentials.token;
        if (typeof token !== 'string' || token.trim() === '') {
          throw new Error('selected OpenAI account is missing token credentials');
        }
        // `oh` / the OpenAI SDK read OPENAI_API_KEY from the environment natively.
        accountEnv = { OPENAI_API_KEY: token };
      } else {
        // The `claude` CLI has no headless email/password login — the only way to
        // drive a *specific* Claude subscription account is to point it at that
        // account's own logged-in config dir. We validate the stored credentials
        // decrypt cleanly (integrity/provisioning check) but never inject them:
        // they are inert to `claude` and would only widen the secret surface.
        // Selection is enforced via a per-account CLAUDE_CONFIG_DIR instead — an
        // un-provisioned account fails closed ("not logged in") rather than
        // silently running under whatever ambient ~/.claude session exists.
        const email = credentials.email;
        if (typeof email !== 'string' || email.trim() === '') {
          throw new Error('selected Claude account is missing credentials');
        }
        const accountsDir =
          this.configService.get<string>('openharness.claudeAccountsDir') ??
          path.join(os.homedir(), '.dsf', 'claude-accounts');
        accountEnv = { CLAUDE_CONFIG_DIR: path.join(accountsDir, account.id) };
      }
      selectedAccountId = account.id;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.executionTracker.failExecution(
        {
          executionId: execution.id,
          errorMessage:
            error instanceof NoEligibleAccountError
              ? message
              : `AI account preparation failed: ${message}`,
          isRetryable: false,
        },
        execution.id,
      );
      return execution.id;
    }

    // Record routing once, up-front, in a single write — avoids duplicating the
    // selected_model/account write across the success/failure branches.
    await this.prisma.execution.update({
      where: { id: execution.id },
      data: { selected_model: model, selected_account_id: selectedAccountId },
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

    // Resolve the working directory to a clone of the *ticket's project* repo, so
    // the agent works in — and the branch is later pushed to — the correct GitHub
    // remote, not the DSF backend repo (the old process.cwd() default). Fails the
    // run if a configured project repo cannot be prepared, rather than silently
    // committing into the wrong repository.
    let baseRepoDir = workspaceDir;
    let projectRepo: { id: string; repositoryUrl: string; defaultBranch: string } | null = null;
    try {
      const resolved = await this.projectWorkspace.resolveWorkspaceDir(ticketId, workspaceDir);
      baseRepoDir = resolved.dir;
      projectRepo = resolved.project;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.executionTracker.failExecution(
        {
          executionId: execution.id,
          errorMessage: `Project workspace preparation failed: ${message}`,
          isRetryable: false,
        },
        execution.id,
      );
      return execution.id;
    }

    // Resolve this project's own Lore credentials so its memory stays isolated
    // from every other project's concurrent runs (see resolveLoreEnv).
    const loreEnv = await this.resolveLoreEnv(projectRepo?.id);

    // Branch the agent commits to; also the ref the code-delivery push targets.
    const ticketBranch = `ohp/${clickUpTaskId}`;

    // Provision an isolated worktree so the agent never mutates the live working
    // tree. If isolation is requested but fails, fail closed rather than running
    // in-place against the repo (the unsafe behaviour OHP-2.6 flagged).
    let runWorkspaceDir = baseRepoDir;
    if (isolateWorkspace) {
      try {
        // Persistent per-ticket branch: every leg of a ticket's loop shares one
        // branch, so a prior leg's commit is visible to the next (review/QA see
        // the implement diff). The worktree is per-run and torn down each leg;
        // the branch survives in the object store. Resolves OHP-2.6 Finding 3.
        //
        // Dependency chaining: a dependent ticket must build on its blockers'
        // work even before that work is merged to the default branch. Fork off
        // main (latest) then merge in any blocker branch not yet in main, so the
        // agent sees the dependency code instead of a stale base.
        const baseBranches = projectRepo
          ? await this.resolveUnmergedBlockerBranches(
              baseRepoDir,
              ticketId,
              projectRepo.defaultBranch,
            )
          : [];
        runWorkspaceDir = this.provisionWorktree(
          baseRepoDir,
          execution.id,
          ticketBranch,
          baseBranches,
        );
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
            ...loreEnv,
            LORE_SLUG: this.configService.get<string>('LORE_SLUG') || process.env.LORE_SLUG || '',
            LORE_KEY: this.configService.get<string>('LORE_KEY') || process.env.LORE_KEY || '',
            OH_RUN_WORKFLOW: skill,
            OH_RUN_MCP_CONFIG: mcpConfigPath,
            // Each wrapper falls back to its own default when its var is unset/empty
            // (`${OH_RUN_MODEL:-gpt-5.4}` / `${CLAUDE_RUN_MODEL:-sonnet}`), so only
            // the var matching the resolved runtime needs the real value.
            OH_RUN_MODEL: runtime === 'oh' ? model : '',
            CLAUDE_RUN_MODEL: runtime === 'claude' ? model : '',
            OH_RUN_MAX_TURNS: String(maxTurns),
            OH_RUN_STREAM_STDOUT: useWrapper ? '1' : '',
            ...accountEnv,
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

      // Secrets injected into the child env can leak into the stream (e.g. a Lore
      // MCP error echoing its Authorization header). The wrapper redacts the
      // persisted log file, but the live stream is consumed here BEFORE that scan
      // and its events are persisted as activities — so redact each line up front.
      const secretValues = [
        loreEnv.LORE_API_KEY,
        accountEnv.OPENAI_API_KEY,
        this.configService.get<string>('BMAD_API_KEY') || process.env.BMAD_API_KEY,
        this.configService.get<string>('CLICKUP_API_KEY') || process.env.CLICKUP_API_KEY,
      ].filter((v): v is string => typeof v === 'string' && v.length > 0);

      if (child.stdout) {
        const rl = readline.createInterface({ input: child.stdout });
        rl.on('line', (rawLine) => {
          const line = this.redactSecrets(rawLine, secretValues);
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
          const text = this.redactSecrets(data.toString().trim(), secretValues);
          this.logger.debug(`[${execution.id}] STDERR: ${text}`);
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
            const tokenUsage = parser.getTokenUsage();
            try {
              await this.logRunCost({
                executionId: execution.id,
                ticketId,
                skill,
                model,
                selectedAccountId,
                inputTokens: tokenUsage.inputTokens,
                outputTokens: tokenUsage.outputTokens,
              });
            } catch (e) {
              this.logger.error(e);
            }
            // Record usage on every terminal path for a spawned run — even if the
            // terminal persist above threw — so the account's budget reflects the
            // work it actually did. Independent try/catch: a usage-write failure
            // must not swallow the resolve() or the worktree teardown below.
            if (selectedAccountId) {
              try {
                // Cache reads are excluded from the metered total (EXEC-CRIT-4);
                // log them so the split stays auditable without a schema change.
                this.logger.log(
                  `Token usage for execution ${execution.id}: ` +
                    `metered=${parser.getTokensUsed()} ` +
                    `(input=${tokenUsage.inputTokens ?? 0}, output=${tokenUsage.outputTokens ?? 0}), ` +
                    `cache_read=${tokenUsage.cachedInputTokens ?? 0} (not metered)`,
                );
                await this.accountSelector.recordUsage(selectedAccountId, {
                  requests: 1,
                  tokens: parser.getTokensUsed(),
                });
              } catch (e) {
                this.logger.error(e);
              }
            }
            // Tear down the isolated worktree on every terminal path (success,
            // failure, timeout). Best-effort: never block resolution on cleanup.
            if (isolateWorkspace && runWorkspaceDir !== baseRepoDir) {
              this.removeWorktree(baseRepoDir, runWorkspaceDir);
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
          // Git is the source of truth for what changed — the stream parser only
          // sees files the agent *announces* via `files_changed` events, which the
          // claude runtime never emits, so trusting it leaves `files_changed` empty
          // and the approval gate blind (QA-2026-07-13 EXEC-CRIT-5). Read both the
          // committed diff AND the working tree: the agent is not trusted to commit.
          const filesChanged = this.resolveChangedFiles(
            runWorkspaceDir,
            isolateWorkspace && projectRepo ? projectRepo.defaultBranch : undefined,
            parser.getFilesChanged(),
          );
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

            // The agent is not trusted to commit: on the claude runtime it often
            // finishes an implementation with everything still in the working
            // tree, and the worktree is torn down moments later — which destroyed
            // the work outright while the run reported COMPLETED (QA-2026-07-13
            // §2.1d). Commit after the formatter so the branch carries formatted
            // code, and before teardown so the branch is the durable artifact the
            // diff, the approval gate and the GitHub push all read.
            if (isolateWorkspace && projectRepo) {
              this.commitPendingWork(runWorkspaceDir, execution.id, clickUpTaskId, skill);
            }

            // Never report a success nobody can review: an implement run that
            // captured no changes did not implement anything, whatever its
            // summary claims (QA-2026-07-13 §2.1d).
            //
            // But this is not a dead end — a zero-diff implement run means the
            // agent stopped short and wants something from a human, and its
            // summary is that ask. FAILED buried the ask in `error_message`
            // where nobody read it and left the ticket needing a manual re-run.
            // Park in PAUSED instead and relay the ask to the PM tool as a task
            // comment; answering it there resumes the ticket automatically.
            if (skill === OpenHarnessSkill.CLICKUP_DEV_IMPLEMENT && filesChanged.length === 0) {
              await this.prisma.execution.update({
                where: { id: execution.id },
                data: {
                  status: ExecutionStatus.PAUSED,
                  error_message: `Implement run produced no file changes on ${ticketBranch} — awaiting input. Summary: ${summary}`,
                  // Discriminator: PAUSED is also used for manual pause
                  // (Story 10-U-5), so the resume poller keys off this marker to
                  // resume ONLY the runs it parked here, never a human-paused one.
                  error_context: JSON.stringify({ awaitingInput: true, taskId: clickUpTaskId }),
                },
              });

              this.eventBus.emit(
                'openharness.needs-input',
                new OpenHarnessNeedsInputEvent(
                  execution.id,
                  ticketId,
                  projectRepo?.id ?? null,
                  clickUpTaskId,
                  summary,
                  skill,
                  execution.id,
                ),
              );
              return;
            }

            // Persist 100% alongside tools_used so a reloaded/closed card shows a
            // full bar — emitProgress's mid-run writes only carried {currentStep,
            // percentComplete}, and without this the final write would reset it.
            await this.prisma.execution.update({
              where: { id: execution.id },
              data: {
                progress: {
                  tools_used: toolsUsed,
                  currentStep: 'Completed',
                  percentComplete: 100,
                } as Prisma.InputJsonValue,
              },
            });

            // Snap the live progress bar to 100% (the mid-run creep caps below it).
            await this.executionTracker
              .emitProgress(execution.id, ticketId, null, 'Completed', 100, 'COMPLETED')
              .catch(() => undefined);

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

            // EXEC-3: a `clickup-qa` run is the only skill that produces a QA
            // verdict — persist it into the linked QAResult so the execution's QA
            // tab and the approval gate stop showing "No QA attempt data
            // available". Other skills leave qa_result null.
            if (skill === OpenHarnessSkill.CLICKUP_QA) {
              await this.persistQaVerdict(execution.id, summary);
            }

            // Hand off to GitHub delivery: push the committed branch (and, when
            // approval is not required, open the PR). Only when the run executed
            // in an isolated worktree on a real project repo — otherwise there is
            // no dedicated branch / remote to push to. Decoupled via the EventBus
            // so this module never imports the GitHub module.
            if (isolateWorkspace && projectRepo) {
              this.eventBus.emit(
                'openharness.code-ready',
                new OpenHarnessCodeReadyEvent(
                  execution.id,
                  ticketId,
                  projectRepo.id,
                  ticketBranch,
                  baseRepoDir,
                  projectRepo.repositoryUrl,
                  skill,
                  execution.id,
                ),
              );
            }
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

  private async logRunCost(params: {
    executionId: string;
    ticketId: string;
    skill: string;
    model: string;
    selectedAccountId: string;
    inputTokens: number | null;
    outputTokens: number | null;
  }): Promise<void> {
    const execution = await this.prisma.execution.findUnique({
      where: { id: params.executionId },
      select: {
        started_at: true,
        completed_at: true,
        failed_at: true,
        selected_model: true,
        selected_account_id: true,
        ticket: { select: { project_id: true } },
      },
    });
    const terminalAt = execution?.completed_at ?? execution?.failed_at ?? new Date();
    const durationMs = execution?.started_at
      ? Math.max(0, terminalAt.getTime() - execution.started_at.getTime())
      : null;

    await this.costTracker.logCost({
      executionId: params.executionId,
      ticketId: params.ticketId,
      provider: AIProvider.OPENHARNESS,
      model: execution?.selected_model ?? params.model,
      selectedAccountId: (execution?.selected_account_id ?? params.selectedAccountId) || null,
      projectId: execution?.ticket?.project_id ?? undefined,
      skill: params.skill,
      durationMs,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      operationType: 'openharness-run',
      agentName: params.skill,
    });
  }

  /**
   * Create a per-run git worktree under a temp path, checked out on the shared
   * per-ticket `branch`. The worktree is a clean checkout that shares `repoDir`'s
   * object store, so the agent can commit without touching the live working tree.
   * The branch persists across legs (created from HEAD on first use, reused
   * thereafter) so each leg sees prior legs' commits. `node_modules` is symlinked
   * so the agent can run tests/typecheck. Returns the worktree path.
   */
  /**
   * Replace every occurrence of each secret value with `[REDACTED]`. Fixed-string
   * replace (no regex) so token characters never need escaping; `[REDACTED]` keeps
   * surrounding JSON valid since it carries no quotes or structural characters.
   */
  private redactSecrets(text: string, secrets: string[]): string {
    let out = text;
    for (const secret of secrets) {
      // Guard empty: split('') would explode every character. The caller filters
      // empties, but keep the helper safe on its own.
      if (secret && out.includes(secret)) out = out.split(secret).join('[REDACTED]');
    }
    return out;
  }

  private provisionWorktree(
    repoDir: string,
    executionId: string,
    branch: string,
    baseBranches: string[] = [],
  ): string {
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
      // A prior run's worktree for this per-ticket branch may still be registered
      // and on disk (teardown skipped on crash/kill/dev-server restart). git allows
      // a branch in only one worktree, so `worktree add <branch>` would fail with
      // "already used by worktree at ...". `worktree prune` above only clears
      // worktrees whose dirs were deleted, so remove any stale one still holding it.
      // ponytail: assumes no legit concurrent run on the same ticket branch — the
      // file-locks module serializes per-ticket work, so a held branch is stale.
      this.removeStaleWorktreeForBranch(repoDir, branch, executionId);
      // Reuse the persistent branch so prior legs' commits are visible.
      execFileSync('git', ['-C', repoDir, 'worktree', 'add', dir, branch], { stdio: 'pipe' });
    } else {
      const head = execFileSync('git', ['-C', repoDir, 'rev-parse', 'HEAD'], {
        encoding: 'utf8',
      }).trim();
      execFileSync('git', ['-C', repoDir, 'worktree', 'add', '-b', branch, dir, head], {
        stdio: 'pipe',
      });
      // Stack this fresh branch on top of its blockers' unmerged work. A conflict
      // fails the run loudly rather than silently: dropping the merge would rebuild
      // the exact dependency-invisibility bug this chaining exists to prevent.
      for (const base of baseBranches) {
        try {
          execFileSync('git', ['-C', dir, 'merge', '--no-edit', base], { stdio: 'pipe' });
        } catch {
          try {
            execFileSync('git', ['-C', dir, 'merge', '--abort'], { stdio: 'pipe' });
          } catch {
            /* nothing to abort */
          }
          throw new Error(
            `Failed to chain dependency branch '${base}' into '${branch}': merge conflict. ` +
              `Merge '${base}' into the default branch (or merge the default branch into '${base}'), then retry.`,
          );
        }
      }
      if (baseBranches.length > 0) {
        this.logger.log(
          `[${executionId}] Chained ${baseBranches.length} unmerged dependency branch(es) into ${branch}: ${baseBranches.join(', ')}`,
        );
      }
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
        this.excludeNodeModules(dir);
      } catch {
        /* ignore — tests may be blocked but AC file checks still work */
      }
    }
    this.logger.log(`[${executionId}] Provisioned isolated worktree at ${dir} (branch ${branch})`);
    return dir;
  }

  /**
   * Force-remove any git worktree currently checked out on `branch`. Used before
   * re-adding a persistent per-ticket branch so a stale worktree left by a crashed
   * or restarted prior run can't cause "'<branch>' is already used by worktree at".
   */
  private removeStaleWorktreeForBranch(repoDir: string, branch: string, executionId: string): void {
    let list: string;
    try {
      list = execFileSync('git', ['-C', repoDir, 'worktree', 'list', '--porcelain'], {
        encoding: 'utf8',
      });
    } catch {
      return;
    }
    // Porcelain output is blank-line-separated blocks; each holding a checked-out
    // branch has a `branch refs/heads/<name>` line and a leading `worktree <path>`.
    for (const block of list.split('\n\n')) {
      if (!block.includes(`branch refs/heads/${branch}`)) continue;
      const pathMatch = block.match(/^worktree (.+)$/m);
      if (!pathMatch) continue;
      try {
        execFileSync('git', ['-C', repoDir, 'worktree', 'remove', '--force', pathMatch[1]], {
          stdio: 'pipe',
        });
        this.logger.warn(
          `[${executionId}] Removed stale worktree ${pathMatch[1]} holding branch ${branch}`,
        );
      } catch {
        /* best effort — the subsequent worktree add will surface any real problem */
      }
    }
    try {
      execFileSync('git', ['-C', repoDir, 'worktree', 'prune'], { stdio: 'pipe' });
    } catch {
      /* ignore */
    }
  }

  /**
   * Blocker branches whose work is committed but not yet in the default branch —
   * the set a dependent ticket must chain onto so it builds on its dependencies'
   * code instead of a stale main. A blocker whose branch is already an ancestor of
   * the default branch is skipped (a plain fork off main already contains it); one
   * whose branch never landed in this clone is skipped (nothing to chain).
   *
   * Deliberately keyed off git ancestry, NOT the dependency's RESOLVED status: a
   * blocker can be marked done in the PM tool before its PR merges, and that race
   * is exactly when the dependent needs the chain.
   */
  private async resolveUnmergedBlockerBranches(
    repoDir: string,
    ticketId: string,
    defaultBranch: string,
  ): Promise<string[]> {
    const blockers = await this.prisma.ticketDependency.findMany({
      where: { ticket_id: ticketId, type: DependencyEdgeType.waiting_on },
      select: { depends_on: true },
    });
    const branches: string[] = [];
    for (const { depends_on } of blockers) {
      const branch = `ohp/${depends_on}`;
      try {
        // Branch must exist locally to chain onto it.
        execFileSync(
          'git',
          ['-C', repoDir, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`],
          { stdio: 'pipe' },
        );
      } catch {
        continue;
      }
      try {
        // Already merged into the default branch → plain fork off main has it.
        execFileSync('git', ['-C', repoDir, 'merge-base', '--is-ancestor', branch, defaultBranch], {
          stdio: 'pipe',
        });
      } catch {
        branches.push(branch);
      }
    }
    return branches;
  }

  /**
   * Keep the `node_modules` symlink this class just created out of git's sight,
   * so the sweep commit can be a plain `git add -A`. Nearly every repo already
   * gitignores it; this covers the one that doesn't, where the symlink would
   * otherwise be committed to the ticket branch and pushed to GitHub.
   *
   * Excluding via git's own ignore file rather than an `:(exclude)` pathspec is
   * deliberate: `git add -A -- . ':(exclude)node_modules'` FAILS outright ("paths
   * are ignored by one of your .gitignore files") in the normal repo that does
   * ignore it, which silently reduced the sweep to a no-op on a live run.
   */
  private excludeNodeModules(worktreeDir: string): void {
    try {
      const excludeFile = execFileSync(
        'git',
        ['-C', worktreeDir, 'rev-parse', '--git-path', 'info/exclude'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      ).trim();
      const resolved = path.resolve(worktreeDir, excludeFile);
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const current = fs.existsSync(resolved) ? fs.readFileSync(resolved, 'utf8') : '';
      if (/^node_modules\/?$/m.test(current)) return;
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      fs.mkdirSync(path.dirname(resolved), { recursive: true });
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      fs.appendFileSync(
        resolved,
        `${current && !current.endsWith('\n') ? '\n' : ''}node_modules\n`,
      );
    } catch {
      /* best-effort: a repo that gitignores node_modules (i.e. all of them) is fine anyway */
    }
  }

  /**
   * Authoritative changed-file list for a run: everything git can see in the
   * worktree — the ticket branch's committed diff against the project's base
   * branch UNION the uncommitted working tree. Both halves are required: the
   * agent commits only sometimes (the original EXEC-CRIT-5 fix read only the
   * committed diff and captured nothing on a run where the agent never
   * committed — QA-2026-07-13 §2.1d), and prior legs of the ticket's loop live
   * only in commits. Falls back to the parser's announced list when git can't
   * answer at all — the claude runtime never emits those events, so this is a
   * last resort, not the primary path.
   */
  private resolveChangedFiles(
    workspaceDir: string,
    baseBranch: string | undefined,
    parserFiles: string[],
  ): string[] {
    const files = new Set<string>(this.workingTreeFiles(workspaceDir));

    if (baseBranch) {
      // The clone is checked out on `default_branch` (git clone --branch), so the
      // local ref normally resolves — but never silently skip the committed diff
      // on a ref miss. Try the local branch, then `origin/<branch>`. Three-dot
      // (`base...HEAD`) matches the GitHub compare link the reviewer opens and
      // ignores unrelated drift on the base branch.
      for (const base of [baseBranch, `origin/${baseBranch}`]) {
        try {
          const out = execFileSync(
            'git',
            ['-C', workspaceDir, 'diff', '--name-only', `${base}...HEAD`],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
          );
          for (const file of out
            .split('\n')
            .map((f) => f.trim())
            .filter(Boolean)) {
            files.add(file);
          }
          break;
        } catch {
          // try the next candidate base ref
        }
      }
    }

    return files.size > 0 ? [...files] : parserFiles;
  }

  /**
   * Files the agent left uncommitted in the worktree: staged, unstaged and
   * untracked (ignored files excluded — `--untracked-files=all` respects
   * .gitignore, so node_modules and build output stay out).
   */
  private workingTreeFiles(workspaceDir: string): string[] {
    let out: string;
    try {
      out = String(
        execFileSync(
          'git',
          ['-C', workspaceDir, 'status', '--porcelain=v1', '-z', '--untracked-files=all'],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
        ) ?? '',
      );
    } catch {
      return [];
    }
    // NUL-separated (`-z`) so paths with spaces/quotes arrive verbatim. Each
    // entry is `XY <path>`; for a rename/copy the *following* field is the
    // source path, which is not a change of its own — skip it.
    const fields = out.split('\0').filter(Boolean);
    const files: string[] = [];
    for (let i = 0; i < fields.length; i++) {
      // eslint-disable-next-line security/detect-object-injection -- `i` is a loop counter over a local array
      const entry = fields[i];
      if (entry.length < 4) continue;
      files.push(entry.slice(3));
      if (entry[0] === 'R' || entry[0] === 'C') i++;
    }
    return files;
  }

  /**
   * Commit whatever the agent left in the worktree onto the ticket branch, so the
   * branch — not the about-to-be-deleted worktree — holds the work. No-op when the
   * agent already committed everything. Best-effort: a commit failure must not
   * fail a run whose changed files were captured anyway.
   *
   * ponytail: one sweep commit per leg, authored by DSF with a fixed identity.
   * Upgrade path: attribute to the requesting user / split per logical change if
   * reviewers ever need finer history than "what this leg produced".
   */
  private commitPendingWork(
    workspaceDir: string,
    executionId: string,
    clickUpTaskId: string,
    skill: string,
  ): void {
    try {
      execFileSync('git', ['-C', workspaceDir, 'add', '-A'], { stdio: 'pipe' });
      const staged = execFileSync('git', ['-C', workspaceDir, 'diff', '--cached', '--name-only'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (!staged) return;
      execFileSync(
        'git',
        [
          '-C',
          workspaceDir,
          // Inline identity: the runner must not depend on ambient git config.
          '-c',
          'user.name=Dark Software Factory',
          '-c',
          'user.email=bot@dsf.local',
          'commit',
          '-m',
          `chore(${skill}): capture agent work for CU-${clickUpTaskId}\n\nThe agent left these changes uncommitted; DSF committed them so the work survives worktree teardown.`,
        ],
        { stdio: 'pipe' },
      );
      this.logger.log(
        `[${executionId}] Committed the agent's uncommitted work (${staged.split('\n').length} files)`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`[${executionId}] Failed to commit pending agent work: ${message}`);
    }
  }

  /**
   * Persist a QA run's verdict into the execution-linked QAResult (EXEC-3). The
   * OpenHarness stream carries no structured lint/test/review breakdown, so this
   * records a single verdict derived from the run reaching clean completion, with
   * the agent's summary kept for human review.
   *
   * ponytail: run-completed is treated as gate-passed and mirrored across the
   * sub-gates — a QA run that finishes but reports failures in its summary will
   * still read as passed. Upgrade path: have the clickup-qa workflow emit a
   * structured verdict (linting/tests/review booleans) and map it here.
   */
  private async persistQaVerdict(executionId: string, summary: string): Promise<void> {
    const passed = true; // only reached on clean completion of the QA workflow
    const reviewIssues: Prisma.InputJsonValue = { summary };
    try {
      await this.prisma.qAResult.upsert({
        where: { execution_id: executionId },
        create: {
          execution_id: executionId,
          linting_passed: passed,
          tests_passed: passed,
          code_review_passed: passed,
          overall_passed: passed,
          code_review_issues: reviewIssues,
        },
        update: {
          linting_passed: passed,
          tests_passed: passed,
          code_review_passed: passed,
          overall_passed: passed,
          code_review_issues: reviewIssues,
        },
      });
    } catch (error) {
      // A QA-record write must never fail the run it describes.
      this.logger.warn(
        `[${executionId}] Failed to persist QA verdict: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
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
