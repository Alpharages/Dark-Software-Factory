# Story WR-4.3: Implement the PM Resolution Endpoint

Status: ready-for-dev

## Story

As a **PM who sees a QA-failed execution**,
I want to call `POST /api/v1/executions/:id/resolve-qa-failure` with either `open_pr` or `cancel`,
So that I can decide in one API call whether to open the PR for manual review or cancel and hand the branch to a developer — without any manual GitHub or ClickUp intervention.

## Acceptance Criteria

**AC-1: `open_pr` action creates a PR on the pushed branch**
**Given** an execution in `QA_FAILED` state with `qa_failed_branch` populated
**When** `POST /api/v1/executions/:id/resolve-qa-failure` is called with `{ "action": "open_pr" }`
**Then** a PR is created on the pushed branch using `GitHubService.createPullRequest()` (FR-WR10)
**And** the PR has a `qa-failed` label attached
**And** the response includes `{ action: 'open_pr', prUrl, prNumber }`

**AC-2: `open_pr` moves ClickUp ticket to `code_review_status`**
**Given** the `open_pr` action completes PR creation successfully
**When** `PMExecutionStatusService.notifyCodeReview()` runs
**Then** the ClickUp ticket is moved to the project's `code_review_status` via runtime discovery (no hardcoded status strings) (FR-WR10, FR-WR11)
**And** if `code_review_status` is not configured, a warning is logged and execution still transitions to COMPLETED

**AC-3: `open_pr` marks execution COMPLETED**
**Given** PR creation and ClickUp notification both succeed (or ClickUp is best-effort)
**When** the endpoint returns
**Then** execution status is set to `COMPLETED` (FR-WR10)
**And** a `GitHubPush` record is created with `pr_number`, `pr_url`, `push_status: 'PR_CREATED'`

**AC-4: `cancel` action leaves branch in place, marks execution FAILED**
**Given** an execution in `QA_FAILED` state
**When** the endpoint is called with `{ "action": "cancel" }`
**Then** no PR is created — branch remains on GitHub untouched (FR-WR10)
**And** execution status is set to `FAILED` (no retry — isRetryable: false)
**And** the response includes `{ action: 'cancel', branchName }`

**AC-5: `cancel` moves ClickUp ticket to `manual_review_status`**
**Given** the `cancel` action
**When** `PMExecutionStatusService.notifyCancel()` runs
**Then** the ClickUp ticket is moved to the project's `manual_review_status` via runtime discovery (FR-WR10, FR-WR11)
**And** if `manual_review_status` is not configured, a warning is logged and execution still transitions to FAILED

**AC-6: 404 on unknown execution**
**Given** an execution ID that does not exist
**When** the endpoint is called
**Then** `404 Not Found` is returned

**AC-7: 409 when execution is not in QA_FAILED state**
**Given** an execution in any state other than `QA_FAILED` (e.g., COMPLETED, IN_PROGRESS)
**When** the endpoint is called
**Then** `409 Conflict` is returned with message `"Execution ${id} is not in QA_FAILED state — current state: ${status}"`

**AC-8: 422 when `open_pr` called but no branch was pushed**
**Given** an execution in `QA_FAILED` state with `qa_failed_branch` null
**When** the endpoint is called with `{ "action": "open_pr" }`
**Then** `422 Unprocessable Entity` is returned with message `"Execution ${id} has no pushed branch — cannot open PR"`

**AC-9: Role guard — PM, ADMIN, TL only**
**Given** an authenticated user with role VIEWER or QA
**When** the endpoint is called
**Then** `403 Forbidden` is returned

**AC-10: Build clean**
**Given** all changes applied
**When** `pnpm test -- --testPathPattern="qa-failure-resolution|pm-execution-status"` runs
**Then** all tests pass with zero TypeScript errors (`pnpm typecheck`)

---

## Tasks / Subtasks

> **Prerequisites:** WR-4.1 (`wr-4-1-implement-hard-qa-failure-provider-behaviour-state-transition.md`) and WR-4.2 (`wr-4-2-add-per-project-qa-failure-manual-review-status-configuration.md`) must be merged before implementing WR-4.3. WR-4.1 adds `QA_FAILED` status + `qa_failed_branch` field. WR-4.2 adds `code_review_status` + `manual_review_status` + `qa_failure_status` to the `Project` model.

---

- [ ] Task 1: Add `addLabelsToPR()` to `GitHubService` (AC: 1)

  In `src/github/github.service.ts`, add this method after `addPRComment()` (around line 260):

  ```typescript
  /**
   * Add labels to a PR (creates labels if they don't exist — idempotent).
   * Uses issues API (GitHub PRs are issues under the hood).
   * Swallows label creation 422 ("already_exists") — safe to call multiple times.
   */
  async addLabelsToPR(
    owner: string,
    repo: string,
    prNumber: number,
    labels: string[],
    installationId?: string,
  ): Promise<void> {
    await this.clientService.execute(
      async (client: Octokit) => {
        // Ensure labels exist (idempotent — 422 means already exists, that's fine)
        for (const label of labels) {
          try {
            await client.issues.createLabel({ owner, repo, name: label, color: 'e11d48' });
          } catch {
            // Label already exists or creation failed — proceed anyway
          }
        }
        await client.issues.addLabels({ owner, repo, issue_number: prNumber, labels });
      },
      installationId,
      'addLabelsToPR',
    );
  }
  ```

  > **Pattern:** Matches existing methods in `github.service.ts` — same `this.clientService.execute(async (client) => {...}, installationId, 'operationName')` signature.

---

- [ ] Task 2: Add `notifyCodeReview()` and `notifyCancel()` to `PMExecutionStatusService` (AC: 2, 5)

  In `src/integrations/pm-execution-status.service.ts`, add these two methods after `notifyQAFailure()` (added by WR-4.1):
  - [ ] 2.1 Add `notifyCodeReview()` — moves ticket to `code_review_status` after open_pr:

    ```typescript
    /**
     * Move ClickUp ticket to the project's configured code_review_status (WR-4.3).
     * Called after open_pr action creates a PR on the qa-failed branch.
     * If code_review_status is not configured, logs warning and posts config-gap comment — never throws.
     */
    async notifyCodeReview(
      projectId: string,
      ticketId: string,
      prUrl: string,
      correlationId?: string,
    ): Promise<void> {
      await this.moveTicketToConfiguredStatus(
        projectId,
        ticketId,
        'code_review_status',
        `Code review PR created: ${prUrl}`,
        correlationId,
      );
    }
    ```

  - [ ] 2.2 Add `notifyCancel()` — moves ticket to `manual_review_status` after cancel:

    ```typescript
    /**
     * Move ClickUp ticket to the project's configured manual_review_status (WR-4.3).
     * Called after cancel action. If manual_review_status not configured, logs warning — never throws.
     */
    async notifyCancel(
      projectId: string,
      ticketId: string,
      correlationId?: string,
    ): Promise<void> {
      await this.moveTicketToConfiguredStatus(
        projectId,
        ticketId,
        'manual_review_status',
        'Execution cancelled by PM — branch preserved for manual developer review.',
        correlationId,
      );
    }
    ```

  - [ ] 2.3 Add the private `moveTicketToConfiguredStatus()` helper that both methods share:

    ```typescript
    /**
     * Generic helper: read a configured status field from the Project model,
     * resolve the live ClickUp status ID, and apply the transition.
     * Logs a warning and posts a config-gap comment if the field is null — never throws.
     *
     * @param statusField  One of: 'code_review_status' | 'manual_review_status'
     * @param contextNote  Included in the config-gap comment if status not configured
     */
    private async moveTicketToConfiguredStatus(
      projectId: string,
      ticketId: string,
      statusField: 'code_review_status' | 'manual_review_status',
      contextNote: string,
      correlationId?: string,
    ): Promise<void> {
      const tag = correlationId ? `[${correlationId}] ` : '';
      try {
        // 1. Resolve clickup_task_id
        const ticket = await this.prisma.ticket.findUnique({
          where: { id: ticketId },
          select: { clickup_task_id: true },
        });
        if (!ticket?.clickup_task_id) {
          this.logger.warn(`${tag}No clickup_task_id for ticket ${ticketId} — skipping`);
          return;
        }
        const clickupTaskId = ticket.clickup_task_id;

        // 2. Resolve integration
        const integration = await this.integrationService.findByProjectAndProvider(
          projectId,
          PMProvider.CLICKUP,
        );
        if (!integration) {
          this.logger.warn(`${tag}No CLICKUP integration for project ${projectId} — skipping`);
          return;
        }

        // 3. Get provider
        const provider = await this.providerFactory.getProvider(integration);

        // 4. Read configured status field from Project (WR-4.2 adds these fields)
        const project = await this.prisma.project.findUnique({ where: { id: projectId } });
        const configuredStatus = project?.[statusField] ?? null;

        if (!configuredStatus) {
          this.logger.warn(
            `${tag}Project ${projectId} has no ${statusField} configured — posting comment`,
          );
          await provider.addComment(
            clickupTaskId,
            `⚠️ **Status Transition Skipped — Configuration Gap**\n\n` +
              `${contextNote}\n\n` +
              `**Action required:** Configure \`${statusField}\` in project settings to enable automatic ClickUp status transitions.`,
          );
          return;
        }

        // 5. Runtime status discovery (no hardcoded IDs)
        const task = await provider.getTask(clickupTaskId);
        if (!task.listId) {
          this.logger.warn(`${tag}Task ${clickupTaskId} has no listId — skipping`);
          return;
        }
        const statuses = await provider.getStatuses(task.listId);
        const target = statuses.find(
          (s) => s.name.toLowerCase() === configuredStatus.toLowerCase(),
        );
        if (!target) {
          this.logger.warn(
            `${tag}${statusField} '${configuredStatus}' not found in list statuses — skipping`,
          );
          return;
        }

        // 6. Apply transition
        await provider.updateStatus(clickupTaskId, target.name);
        this.logger.log(
          `${tag}ClickUp ${clickupTaskId}: '${task.status.name}' → '${target.name}' (${statusField})`,
        );
      } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.logger.warn(
          `${tag}Status transition skipped for ticket ${ticketId} [${statusField}]: ${err.message}`,
        );
      }
    }
    ```

  > **Pattern:** `moveTicketToConfiguredStatus()` is the exact same structure as `notifyQAFailure()` in WR-4.1 — same try/catch, same ClickUp resolution flow, same config-gap fallback. The only difference is which `Project` field is read. Do NOT duplicate the ClickUp resolution logic again — extract it into the shared private method.
  >
  > **Type note:** `project?.[statusField]` uses indexed access on the Prisma `Project` type. After WR-4.2 runs `pnpm db:generate`, both `code_review_status` and `manual_review_status` are typed as `string | null` on `Project`. TypeScript will accept `project?.[statusField]` where `statusField` is narrowed to the union type above.

---

- [ ] Task 3: Create `ResolveQaFailureDto` (AC: 1, 4)

  Create `src/execution/dto/resolve-qa-failure.dto.ts`:

  ```typescript
  import { IsEnum } from 'class-validator';
  import { ApiProperty } from '@nestjs/swagger';

  export enum QaFailureResolutionAction {
    OPEN_PR = 'open_pr',
    CANCEL = 'cancel',
  }

  export class ResolveQaFailureDto {
    @ApiProperty({
      enum: QaFailureResolutionAction,
      description:
        'open_pr: create PR with qa-failed label, move to code review. cancel: mark FAILED, move to manual review.',
      example: 'open_pr',
    })
    @IsEnum(QaFailureResolutionAction)
    action: QaFailureResolutionAction;
  }
  ```

  Also add `ResolveQaFailureDto` to the barrel export at `src/execution/dto/index.ts`:

  ```typescript
  export { ResolveQaFailureDto, QaFailureResolutionAction } from './resolve-qa-failure.dto';
  ```

---

- [ ] Task 4: Create `QAFailureResolutionService` (AC: 1–8)

  Create `src/execution/services/qa-failure-resolution.service.ts`:

  ```typescript
  import {
    Injectable,
    NotFoundException,
    ConflictException,
    UnprocessableEntityException,
  } from '@nestjs/common';
  import { PrismaService } from '@/database/prisma.service';
  import { ExecutionTrackerService } from '@/execution/execution-tracker.service';
  import { ExecutionRepository } from '@/execution/execution.repository';
  import { GitHubService } from '@/github/github.service';
  import { PMExecutionStatusService } from '@/integrations/pm-execution-status.service';
  import { LoggerService } from '@/common/logger/logger.service';
  import { ExecutionStatus } from '@/execution/enums/execution-status.enum';
  import { QaFailureResolutionAction, ResolveQaFailureDto } from '../dto/resolve-qa-failure.dto';

  export interface QAResolutionResult {
    action: QaFailureResolutionAction;
    prUrl?: string;
    prNumber?: number;
    branchName?: string | null;
  }

  @Injectable()
  export class QAFailureResolutionService {
    constructor(
      private readonly prisma: PrismaService,
      private readonly trackerService: ExecutionTrackerService,
      private readonly repository: ExecutionRepository,
      private readonly githubService: GitHubService,
      private readonly pmStatus: PMExecutionStatusService,
      private readonly logger: LoggerService,
    ) {}

    async resolve(
      executionId: string,
      dto: ResolveQaFailureDto,
      correlationId: string,
    ): Promise<QAResolutionResult> {
      // 1. Load execution with ticket + project
      const execution = await this.prisma.execution.findUnique({
        where: { id: executionId },
        include: {
          ticket: {
            include: { project: true },
          },
        },
      });

      if (!execution) {
        throw new NotFoundException(`Execution ${executionId} not found`);
      }

      // 2. State guard — must be in QA_FAILED
      if (execution.status !== ExecutionStatus.QA_FAILED) {
        throw new ConflictException(
          `Execution ${executionId} is not in QA_FAILED state — current state: ${execution.status}`,
        );
      }

      const project = execution.ticket.project;
      const projectId = project?.id;

      if (dto.action === QaFailureResolutionAction.OPEN_PR) {
        return this.handleOpenPr(execution, projectId, correlationId);
      }
      return this.handleCancel(execution, projectId, correlationId);
    }

    // --------------- open_pr ---------------

    private async handleOpenPr(
      execution: {
        id: string;
        qa_failed_branch: string | null;
        ticket_id: string;
        ticket: {
          title: string;
          clickup_task_id: string | null;
          project: {
            id: string;
            github_repository_url: string;
            default_branch: string;
            github_account_id: string | null;
          } | null;
        };
      },
      projectId: string | undefined,
      correlationId: string,
    ): Promise<QAResolutionResult> {
      // 3. Branch guard
      if (!execution.qa_failed_branch) {
        throw new UnprocessableEntityException(
          `Execution ${execution.id} has no pushed branch — cannot open PR`,
        );
      }

      const project = execution.ticket.project;
      if (!project) {
        throw new UnprocessableEntityException(
          `Execution ${execution.id} has no linked project — cannot resolve repository`,
        );
      }

      // 4. Parse owner/repo from project github_repository_url
      const { owner, repo } = this.parseRepositoryUrl(project.github_repository_url);

      // 5. Resolve per-project GitHub installationId (App auth) — falls back to PAT if null
      const installationId = await this.resolveInstallationId(project.github_account_id);

      // 6. Create PR (no AI title generation — simple template is sufficient here)
      const prTitle = `[QA Failed Review] ${execution.ticket.title}`;
      const prBody =
        `## QA Failure Resolution\n\n` +
        `This PR was opened via the DSF PM resolution workflow after QA retries were exhausted.\n\n` +
        `**Branch:** \`${execution.qa_failed_branch}\`\n` +
        `**Ticket:** ${execution.ticket.clickup_task_id ?? execution.ticket_id}\n\n` +
        `> ⚠️ QA self-healing did not produce a passing build. Please review the code and failing tests before merging.`;

      const prData = (await this.githubService.createPullRequest(
        owner,
        repo,
        prTitle,
        prBody,
        execution.qa_failed_branch,
        project.default_branch || 'main',
        installationId,
      )) as { number: number; html_url: string };

      const prNumber = prData.number;
      const prUrl = prData.html_url;

      // 7. Add qa-failed label (best-effort — does not block execution transition)
      try {
        await this.githubService.addLabelsToPR(
          owner,
          repo,
          prNumber,
          ['qa-failed'],
          installationId,
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `[${correlationId}] Failed to add qa-failed label to PR #${prNumber}: ${msg}`,
        );
      }

      // 8. Persist GitHubPush record so the PR URL is traceable
      await this.prisma.gitHubPush.create({
        data: {
          execution_id: execution.id,
          repository: project.github_repository_url,
          branch_name: execution.qa_failed_branch,
          pr_number: prNumber,
          pr_url: prUrl,
          push_status: 'PR_CREATED',
        },
      });

      // 9. Move ClickUp to code_review_status (best-effort — ClickUp failure must not block execution transition)
      if (projectId) {
        try {
          await this.pmStatus.notifyCodeReview(
            projectId,
            execution.ticket_id,
            prUrl,
            correlationId,
          );
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.warn(`[${correlationId}] ClickUp code_review notification failed: ${msg}`);
        }
      }

      // 10. Transition execution to COMPLETED
      // completeExecution() calls stateMachine.transition(QA_FAILED → COMPLETED) — valid after WR-4.1 adds transition rule
      await this.trackerService.completeExecution(
        { executionId: execution.id, filesChanged: [], confidenceScore: undefined },
        correlationId,
      );

      this.logger.log(
        `[${correlationId}] WR-4.3 open_pr: Execution ${execution.id} resolved — PR #${prNumber} created, status → COMPLETED`,
      );

      return { action: QaFailureResolutionAction.OPEN_PR, prUrl, prNumber };
    }

    // --------------- cancel ---------------

    private async handleCancel(
      execution: { id: string; qa_failed_branch: string | null; ticket_id: string },
      projectId: string | undefined,
      correlationId: string,
    ): Promise<QAResolutionResult> {
      // Move ClickUp to manual_review_status (best-effort)
      if (projectId) {
        try {
          await this.pmStatus.notifyCancel(projectId, execution.ticket_id, correlationId);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.warn(`[${correlationId}] ClickUp manual_review notification failed: ${msg}`);
        }
      }

      // Transition execution to FAILED (isRetryable: false — PM explicitly cancelled, no auto-retry)
      // failExecution() calls stateMachine.transition(QA_FAILED → FAILED) — valid after WR-4.1 adds transition rule
      await this.trackerService.failExecution(
        {
          executionId: execution.id,
          errorMessage:
            'PM cancelled QA-failed execution — branch preserved for manual developer review',
          isRetryable: false,
          errorCode: 'PM_CANCELLED',
        },
        correlationId,
      );

      this.logger.log(
        `[${correlationId}] WR-4.3 cancel: Execution ${execution.id} cancelled — status → FAILED, branch preserved`,
      );

      return { action: QaFailureResolutionAction.CANCEL, branchName: execution.qa_failed_branch };
    }

    // --------------- helpers ---------------

    /**
     * Parse "owner/repo" from a repository URL or "owner/repo" slug.
     * Handles: https://github.com/owner/repo, https://github.com/owner/repo.git, owner/repo
     * Mirrored from GitHubPROrchestrator.parseRepositoryUrl() — same logic.
     */
    private parseRepositoryUrl(repository: string): { owner: string; repo: string } {
      const clean = repository.replace(/\.git$/, '');
      const urlMatch = clean.match(/github\.com\/([^/]+)\/([^/]+)/);
      if (urlMatch) {
        return { owner: urlMatch[1], repo: urlMatch[2] };
      }
      const slugMatch = clean.match(/^([^/]+)\/([^/]+)$/);
      if (slugMatch) {
        return { owner: slugMatch[1], repo: slugMatch[2] };
      }
      throw new UnprocessableEntityException(
        `Cannot parse owner/repo from repository: "${repository}"`,
      );
    }

    /**
     * Resolve GitHub App installationId from github_account_id on the project.
     * Returns undefined if no account linked → GitHubClientService falls back to global PAT.
     * Mirrored from GitHubPROrchestrator.resolveInstallationId().
     */
    private async resolveInstallationId(
      githubAccountId: string | null,
    ): Promise<string | undefined> {
      if (!githubAccountId) return undefined;
      const account = await this.prisma.gitHubAccount.findUnique({
        where: { id: githubAccountId },
        select: { installationId: true },
      });
      return account?.installationId ?? undefined;
    }
  }
  ```

---

- [ ] Task 5: Add `POST :id/resolve-qa-failure` to `ExecutionController` (AC: 1, 4, 6, 7, 8, 9)

  In `src/execution/execution.controller.ts`:
  - [ ] 5.1 Update imports:

    ```typescript
    import {
      Controller,
      Get,
      Post,
      Param,
      Body,
      UseGuards,
      NotFoundException,
      ConflictException,
      UnprocessableEntityException,
    } from '@nestjs/common';
    import { ApiTags, ApiOperation, ApiResponse, ApiParam, getSchemaPath } from '@nestjs/swagger';
    import { ExecutionService } from './execution.service';
    import { QAFailureResolutionService } from './services/qa-failure-resolution.service';
    import { ExecutionResponseDto, ResolveQaFailureDto } from '@/execution/dto';
    import { JwtAuthGuard } from '@/common/guards/auth.guard';
    import { RolesGuard } from '@/common/guards/roles.guard';
    import { Roles } from '@/common/decorators/roles.decorator';
    import { Role } from '@/auth/constants/roles.enum';
    ```

  - [ ] 5.2 Inject `QAFailureResolutionService` in the constructor:

    ```typescript
    constructor(
      private readonly executionService: ExecutionService,
      private readonly resolutionService: QAFailureResolutionService,
    ) {}
    ```

  - [ ] 5.3 Add endpoint after `getStatus()`:
    ```typescript
    @Post(':id/resolve-qa-failure')
    @Roles(Role.PM, Role.ADMIN, Role.TL)
    @ApiOperation({ summary: 'Resolve a QA-failed execution: open PR or cancel' })
    @ApiParam({ name: 'id', description: 'Execution UUID' })
    @ApiResponse({ status: 201, description: 'Resolution applied — returns prUrl (open_pr) or branchName (cancel)' })
    @ApiResponse({ status: 404, description: 'Execution not found' })
    @ApiResponse({ status: 409, description: 'Execution is not in QA_FAILED state' })
    @ApiResponse({ status: 422, description: 'open_pr called but no pushed branch exists' })
    async resolveQaFailure(
      @Param('id') id: string,
      @Body() dto: ResolveQaFailureDto,
    ) {
      const correlationId = `wf-4.3-${id.slice(0, 8)}`;
      return this.resolutionService.resolve(id, dto, correlationId);
    }
    ```

---

- [ ] Task 6: Register `QAFailureResolutionService` in `ExecutionModule` and import `GitHubModule` (AC: all)

  In `src/execution/execution.module.ts`:
  - [ ] 6.1 Add `GitHubModule` import at the top:

    ```typescript
    import { GitHubModule } from '@/github/github.module';
    ```

    Add to `imports` array:

    ```typescript
    forwardRef(() => GitHubModule),  // WR-4.3: QAFailureResolutionService needs GitHubService
    ```

    Use `forwardRef` to avoid potential circular dependency since `AiRoutingModule` already imports `GitHubModule` and `ExecutionModule` imports `AiRoutingModule`.

  - [ ] 6.2 Add service import:

    ```typescript
    import { QAFailureResolutionService } from './services/qa-failure-resolution.service';
    ```

  - [ ] 6.3 Add to `providers` array (near other core services):
    ```typescript
    QAFailureResolutionService,  // WR-4.3: PM resolution endpoint
    ```

  > **Module design:** `GitHubModule` is imported with `forwardRef()` because the dependency graph is: `ExecutionModule → AiRoutingModule → GitHubModule`. Adding `ExecutionModule → GitHubModule` directly could cause issues — wrapping with `forwardRef()` eliminates the risk. `GitHubService` is exported from `GitHubModule` (confirmed at `src/github/github.module.ts:L98`).
  >
  > **IntegrationsModule** is already imported in `ExecutionModule` (line 55 in the module file) — `PMExecutionStatusService` is already available. No additional import needed.

---

- [ ] Task 7: Tests for `QAFailureResolutionService` (AC: 1–8)

  Create `src/execution/services/qa-failure-resolution.service.spec.ts`:

  **Mock setup:**

  ```typescript
  const mockExecution = {
    id: 'exec-123',
    status: 'QA_FAILED',
    qa_failed_branch: 'feature/test-branch',
    ticket_id: 'ticket-456',
    ticket: {
      title: 'Fix login bug',
      clickup_task_id: 'task-789',
      project: {
        id: 'project-001',
        github_repository_url: 'https://github.com/org/repo',
        default_branch: 'main',
        github_account_id: 'account-abc',
      },
    },
  };

  // Mocks: PrismaService, ExecutionTrackerService, ExecutionRepository,
  //        GitHubService, PMExecutionStatusService, LoggerService
  ```

  **Test cases:**
  - `'should throw NotFoundException for unknown execution'` — mock `prisma.execution.findUnique` returns `null`, assert throws `NotFoundException`
  - `'should throw ConflictException when status is not QA_FAILED'` — mock execution with `status: 'IN_PROGRESS'`, assert throws `ConflictException` with message containing `"not in QA_FAILED state"`
  - `'should throw UnprocessableEntityException for open_pr with null qa_failed_branch'` — mock execution with `qa_failed_branch: null`, call with `action: 'open_pr'`, assert throws `UnprocessableEntityException` with "no pushed branch"
  - `'should create PR and transition to COMPLETED on open_pr'` — mock `prisma.gitHubAccount.findUnique` returns `{ installationId: 'install-1' }`, mock `githubService.createPullRequest` returns `{ number: 42, html_url: 'https://github.com/org/repo/pull/42' }`, mock `githubService.addLabelsToPR` resolves, mock `prisma.gitHubPush.create` resolves, mock `pmStatus.notifyCodeReview` resolves, mock `trackerService.completeExecution` resolves, assert result is `{ action: 'open_pr', prUrl: 'https://...', prNumber: 42 }`, assert `trackerService.completeExecution` called with `{ executionId: 'exec-123', filesChanged: [], confidenceScore: undefined }`
  - `'should still complete execution if qa-failed label attachment fails'` — mock `githubService.addLabelsToPR` throws, assert `trackerService.completeExecution` still called (label failure is best-effort)
  - `'should still complete execution if notifyCodeReview fails'` — mock `pmStatus.notifyCodeReview` throws, assert `trackerService.completeExecution` still called
  - `'should create GitHubPush record with PR info on open_pr'` — assert `prisma.gitHubPush.create` called with `{ execution_id: 'exec-123', branch_name: 'feature/test-branch', pr_number: 42, pr_url: 'https://...', push_status: 'PR_CREATED' }`
  - `'should transition to FAILED and return branchName on cancel'` — mock `pmStatus.notifyCancel` resolves, mock `trackerService.failExecution` resolves, assert result is `{ action: 'cancel', branchName: 'feature/test-branch' }`, assert `trackerService.failExecution` called with `{ executionId: 'exec-123', isRetryable: false, errorCode: 'PM_CANCELLED' }`
  - `'should still cancel execution if notifyCancel fails'` — mock `pmStatus.notifyCancel` throws, assert `trackerService.failExecution` still called
  - `'should use fallback to PAT when github_account_id is null'` — mock execution with `project.github_account_id: null`, assert `githubService.createPullRequest` called with `installationId: undefined`
  - `'should use project default_branch for PR base'` — mock execution with `project.default_branch: 'develop'`, assert `githubService.createPullRequest` called with base `'develop'`
  - `'should fall back to main if default_branch is empty'` — mock `project.default_branch: ''`, assert `githubService.createPullRequest` called with base `'main'`

---

- [ ] Task 8: Tests for `PMExecutionStatusService` — `notifyCodeReview` and `notifyCancel` (AC: 2, 5)

  In `src/integrations/pm-execution-status.service.spec.ts`, add two new describe blocks:

  **`notifyCodeReview`:**
  - `'should move ticket to code_review_status when configured'` — mock `prisma.project.findUnique` returning `{ code_review_status: 'Code Review' }`, mock statuses including `{ name: 'Code Review' }`, assert `provider.updateStatus` called with `('task-789', 'Code Review')`, assert `provider.addComment` NOT called
  - `'should post config-gap comment when code_review_status is null'` — mock `prisma.project.findUnique` returning `{ code_review_status: null }`, assert `provider.updateStatus` NOT called, assert `provider.addComment` called with message containing "Configuration Gap"
  - `'should never throw — swallows all errors'` — mock `provider.getTask` throws, assert resolves without throwing

  **`notifyCancel`:**
  - `'should move ticket to manual_review_status when configured'` — mock `prisma.project.findUnique` returning `{ manual_review_status: 'Needs Manual Review' }`, assert `provider.updateStatus` called
  - `'should post config-gap comment when manual_review_status is null'` — mock returns `{ manual_review_status: null }`, assert `provider.addComment` called
  - `'should use case-insensitive status name matching'` — mock `manual_review_status: 'needs manual review'`, mock statuses with `{ name: 'Needs Manual Review' }`, assert `provider.updateStatus` called

---

- [ ] Task 9: Run and verify (AC: 10)
  - [ ] 9.1 `pnpm typecheck` → zero errors (especially validate the `project?.[statusField]` indexed access in Task 2.3 compiles cleanly against the WR-4.2 Prisma-generated types)
  - [ ] 9.2 `pnpm test -- --testPathPattern="qa-failure-resolution"` → green
  - [ ] 9.3 `pnpm test -- --testPathPattern="pm-execution-status"` → green
  - [ ] 9.4 `pnpm test -- --testPathPattern="execution.controller"` → green (ensure existing tests still pass after controller changes)
  - [ ] 9.5 `pnpm build` → clean build

---

## Dev Notes

### Prerequisites — Merge Order Matters

This story depends on:

- **WR-4.1 merged:** Adds `QA_FAILED` to `ExecutionStatus` enum + `VALID_TRANSITIONS` (QA_FAILED → COMPLETED and QA_FAILED → FAILED). Without this, `completeExecution()` and `failExecution()` will throw a state machine error.
- **WR-4.2 merged:** Adds `code_review_status`, `manual_review_status`, `qa_failure_status` to `Project` model in Prisma schema. Without this, `project.code_review_status` won't type-check and `moveTicketToConfiguredStatus()` will always hit the config-gap path.

### What Is Already Built (Do NOT Re-implement)

- `GitHubService.createPullRequest()` — `src/github/github.service.ts:L205`. Use as-is. Returns `unknown` cast to `{ number: number; html_url: string }` (same pattern as `GitHubPROrchestrator`).
- `GitHubModule` exports `GitHubService` at `src/github/github.module.ts:L98`. Import `GitHubModule` into `ExecutionModule` — do NOT instantiate `GitHubService` outside DI.
- `PMExecutionStatusService.notifyQAFailure()` — added by WR-4.1. The new `notifyCodeReview()` and `notifyCancel()` follow the same pattern via the shared `moveTicketToConfiguredStatus()` helper. Do NOT duplicate the ClickUp resolution logic.
- `ExecutionTrackerService.completeExecution()` and `failExecution()` — use them directly. The state machine allows `QA_FAILED → COMPLETED/FAILED` after WR-4.1.
- `ProjectIntegrationService.findByProjectAndProvider()` — already available in `PMExecutionStatusService` via `this.integrationService`.
- `PMProvider.CLICKUP` enum — already imported in `pm-execution-status.service.ts`.

### State Machine Transition Validation

`completeExecution()` calls:

```typescript
this.stateMachine.transition(
  executionId,
  execution.status,
  ExecutionStatus.COMPLETED,
  'AI execution completed successfully',
);
```

After WR-4.1 adds `QA_FAILED → [COMPLETED, FAILED]` to `VALID_TRANSITIONS`, this will pass for executions in `QA_FAILED` state.

`failExecution()` with `isRetryable: false` — the `isRetryable` flag gates the auto-retry block. With `false`, it transitions to `FAILED`, emits events, and returns without scheduling a retry. This is exactly what the cancel path needs.

### PR URL Persistence Pattern

The `Execution` model has no `pr_url` column. The existing pattern (from `GitHubPROrchestrator`) is to create a `GitHubPush` record. WR-4.3 follows this same pattern — `prisma.gitHubPush.create()` with `push_status: 'PR_CREATED'` ties the PR URL to the execution via `execution_id`.

`GitHubPush` required fields: `execution_id`, `repository`, `branch_name`. Optional: `commit_sha`, `pr_number`, `pr_url`, `push_status` (defaults to `PENDING`). [Source: `prisma/schema.prisma:L199–L214`]

### ClickUp Status Moves Are Best-Effort

Both `notifyCodeReview()` and `notifyCancel()` must NEVER prevent the execution state transition. The ClickUp calls are wrapped in try/catch in the resolution service — if ClickUp fails, the execution still transitions to COMPLETED/FAILED. This is consistent with how `notifyQAFailure()` in WR-4.1 is designed.

### `project?.[statusField]` Indexed Access

The `moveTicketToConfiguredStatus()` helper uses `project?.[statusField]` where `statusField` is `'code_review_status' | 'manual_review_status'`. TypeScript will validate this against the Prisma-generated `Project` type after `pnpm db:generate` (WR-4.2). Both fields are `string | null` on `Project`. If TypeScript rejects this pattern (strict indexing), use an explicit switch/ternary instead:

```typescript
const configuredStatus =
  statusField === 'code_review_status'
    ? project?.code_review_status
    : project?.manual_review_status;
```

### `forwardRef` for GitHubModule Import

`ExecutionModule` imports `AiRoutingModule` (line 80), which imports `GitHubModule`. Adding a direct `ExecutionModule → GitHubModule` edge could cause circular dependency warnings. Using `forwardRef(() => GitHubModule)` prevents this. `GitHubService` remains injectable without issues.

### PR Title and Body — No AI Generation

The existing `GitHubPROrchestrator.createPullRequest()` uses Anthropic SDK to generate AI PR titles. For QA-failed resolution PRs, a template is used — no AI call. Reasons:

1. No new code was successfully written (QA failed) — less content to summarize
2. PM is initiating this, not an automated completion
3. Keeps the endpoint response fast

### Files to Create/Modify (Complete List)

| File                                                      | Change                                                                          |
| --------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `src/execution/dto/resolve-qa-failure.dto.ts`             | **NEW** — DTO with `QaFailureResolutionAction` enum                             |
| `src/execution/dto/index.ts`                              | Add barrel export for new DTO                                                   |
| `src/execution/services/qa-failure-resolution.service.ts` | **NEW** — Resolution service                                                    |
| `src/execution/execution.controller.ts`                   | Add `POST :id/resolve-qa-failure` endpoint; inject `QAFailureResolutionService` |
| `src/execution/execution.module.ts`                       | Import `GitHubModule`; register `QAFailureResolutionService`                    |
| `src/github/github.service.ts`                            | Add `addLabelsToPR()` method                                                    |
| `src/integrations/pm-execution-status.service.ts`         | Add `notifyCodeReview()`, `notifyCancel()`, `moveTicketToConfiguredStatus()`    |

### Test Files to Create/Update

| File                                                           | Change                                              |
| -------------------------------------------------------------- | --------------------------------------------------- |
| `src/execution/services/qa-failure-resolution.service.spec.ts` | **NEW** — Resolution service tests                  |
| `src/integrations/pm-execution-status.service.spec.ts`         | Add `notifyCodeReview` + `notifyCancel` test suites |

### References

- [Source: `_bmad-output/planning-artifacts/epics-workspace-removal.md` — FR-WR10, FR-WR11, Story WR-4.3]
- [Source: `_bmad-output/implementation-artifacts/wr-4-1-implement-hard-qa-failure-provider-behaviour-state-transition.md` — Task 2.3: QA_FAILED valid transitions; Task 6: notifyQAFailure() pattern]
- [Source: `_bmad-output/implementation-artifacts/wr-4-2-add-per-project-qa-failure-manual-review-status-configuration.md` — code_review_status, manual_review_status schema fields]
- [Source: `src/github/services/github-pr-orchestrator.service.ts:L354–L388` — parseRepositoryUrl + resolveInstallationId pattern]
- [Source: `src/github/github.service.ts:L205–L238` — createPullRequest]
- [Source: `src/github/github.module.ts:L97–L113` — GitHubModule exports]
- [Source: `src/execution/execution.module.ts` — existing imports; IntegrationsModule already present]
- [Source: `prisma/schema.prisma:L73–L125` — Execution model (no pr_url); L199–L214 — GitHubPush model]
- [Source: `src/execution/execution-tracker.service.ts:L228–L327` — completeExecution(); L330–L430 — failExecution()]

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List
