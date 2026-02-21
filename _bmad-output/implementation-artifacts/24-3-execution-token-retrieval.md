# Story 24.3: Execution Token Retrieval

Status: DONE

## Story

As the AI Orchestrator,
I need to securely retrieve the correct GitHub token based on the project's selected repository,
So I can perform git clone, fetch, and push without auth errors.

## Acceptance Criteria

1. **Token Resolution:** When an execution begins, if `project.github_account_id` is set, the orchestrator resolves the linked `GitHubAccount` from the database and decrypts the stored `accessToken` via `EncryptionService`.
2. **Authenticated Clone URL:** The `GitMirrorService` (for mirror operations) receives a per-project authenticated URL of the form `https://x-access-token:<decrypted_token>@github.com/owner/repo.git` instead of the global `GITHUB_TOKEN` from `ConfigService`.
3. **Authenticated Push URL:** `GitHubCommitOrchestrator.commitAndPush()` injects the per-project authenticated URL into `GitOperationsService.push()` when `project.github_account_id` is set, falling back to the plain `repositoryUrl` (which relies on existing host-level git credential helpers) if no account is linked.
4. **Security:** Decrypted tokens MUST NOT appear in any log output (NFR-S4). The raw token string is discarded immediately after URL construction. Only the `github_account_id` (UUID) and `username` of the resolved account are safe to log.
5. **Graceful Fallback:** If `project.github_account_id` is `null` (project predates Epic 24 or user skipped account connection), the execution continues using the plain repository URL with no error. A `WARN` log records that no per-project token was found.
6. **Not Found Guard:** If `github_account_id` is set but the linked `GitHubAccount` row no longer exists (e.g., user deleted it), the system throws a descriptive `NotFoundException` that triggers execution failure and a ClickUp error comment rather than silently proceeding with an unauthenticated URL.
7. **Unit Tests:** `GitHubTokenResolverService` has Jest tests covering: success (token decrypted + URL built), `null` account ID (fallback URL returned), account not found (throws), and decryption error propagation.

## Tasks / Subtasks

- [x] **Task 1: Create `GitHubTokenResolverService`** (AC: #1, #4, #5, #6)
  - [ ] Create `src/github/github-token-resolver.service.ts`:

    ```typescript
    import { Injectable, Logger, NotFoundException } from '@nestjs/common';
    import { PrismaService } from '../database/prisma.service';
    import { EncryptionService } from '../common/encryption/encryption.service';

    export interface ResolvedGitHubToken {
      /** Plain repository URL with embedded x-access-token credential */
      authenticatedUrl: string;
      /** Username associated with the account — safe to log */
      username: string;
      /** Account UUID — safe to log */
      accountId: string;
    }

    @Injectable()
    export class GitHubTokenResolverService {
      private readonly logger = new Logger(GitHubTokenResolverService.name);

      constructor(
        private readonly prisma: PrismaService,
        private readonly encryption: EncryptionService,
      ) {}

      /**
       * Build an authenticated HTTPS clone/push URL for the given project.
       *
       * Returns null if the project has no linked GitHub account
       * (graceful fallback — caller must use plain URL).
       *
       * Throws NotFoundException if the linked account has been deleted.
       * Throws on decryption failure (corrupted data).
       *
       * SECURITY: never log the returned authenticatedUrl or any intermediate token value.
       */
      async resolveForProject(
        projectId: string,
        plainRepositoryUrl: string,
      ): Promise<ResolvedGitHubToken | null> {
        // 1. Load project's github_account_id
        const project = await this.prisma.project.findUnique({
          where: { id: projectId },
          select: { github_account_id: true },
        });

        if (!project?.github_account_id) {
          this.logger.warn(
            `[TokenResolver] Project ${projectId} has no github_account_id — using plain URL (no per-project auth)`,
          );
          return null;
        }

        const accountId = project.github_account_id;

        // 2. Fetch the linked GitHubAccount
        const account = await this.prisma.gitHubAccount.findUnique({
          where: { id: accountId },
          select: { id: true, username: true, accessToken: true },
        });

        if (!account) {
          throw new NotFoundException(
            `GitHubAccount ${accountId} linked to project ${projectId} no longer exists. ` +
              `PM must re-connect their GitHub account before execution can proceed.`,
          );
        }

        // 3. Decrypt — throws if token data is corrupted
        const decryptedToken = this.encryption.decrypt(account.accessToken);

        // 4. Build authenticated URL (x-access-token convention — works for OAuth user tokens AND fine-grained PATs)
        const authenticatedUrl = plainRepositoryUrl.replace(
          'https://',
          `https://x-access-token:${decryptedToken}@`,
        );

        // SECURITY: do NOT log authenticatedUrl or decryptedToken. Log only account metadata.
        this.logger.log(
          `[TokenResolver] Resolved GitHub token for project ${projectId} via account ${accountId} (${account.username})`,
        );

        // Discard reference to decryptedToken as soon as URL is built
        return { authenticatedUrl, username: account.username, accountId: account.id };
      }
    }
    ```

  - [ ] Register `GitHubTokenResolverService` as a provider in `src/github/github.module.ts` (add to `providers` array and `exports` array so it can be consumed by other modules).

- [x] **Task 2: Inject Token into `GitHubCommitOrchestrator`** (AC: #2, #3, #4, #5)
  - [ ] In `src/github/services/github-commit-orchestrator.service.ts`, add `GitHubTokenResolverService` to the constructor.
  - [ ] In the `commitAndPush()` method, after loading the `execution` and before any push operations, fetch the project and resolve the token:

    ```typescript
    // Load project via ticket's project_id
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: execution.ticket_id },
      select: { project_id: true },
    });

    let resolvedAuth: ResolvedGitHubToken | null = null;
    if (ticket?.project_id) {
      const plainUrl = workspace.repositoryUrl || githubPush.repository;
      resolvedAuth = await this.tokenResolver.resolveForProject(ticket.project_id, plainUrl);
    }
    ```

  - [ ] Replace ALL occurrences of `repositoryUrl` passed to `this.gitOps.push()` with:
    ```typescript
    const pushUrl = resolvedAuth?.authenticatedUrl ?? repositoryUrl;
    await this.gitOps.push(workspace.path, pushUrl, githubPush.branch_name);
    ```
  - [ ] Ensure the plain `repositoryUrl` variable is **never** replaced by `authenticatedUrl` in audit logs, `gitHubPush.repository`, or the Prisma update call. Only the push URL argument to `gitOps.push()` uses the authenticated form.

- [x] **Task 3: Inject Token into `GitMirrorService`** (AC: #2, #4, #5)
  - [ ] `GitMirrorService` currectly has a single `this.gitToken` (from `ConfigService` env var `GITHUB_TOKEN`). The token resolution must be per-operation, not module-level.
  - [ ] Add `GitHubTokenResolverService` to `GitMirrorService` constructor (import `GitMirrorModule` ↔ `GitHubModule` — add `GitHubModule` to `GItMirrorModule` imports to avoid circular dep, OR export resolver from a shared module).
  - [ ] Add an optional `authenticatedUrl?: string` parameter to `getOrCreateMirror(repoUrl: string, authenticatedUrl?: string)`:
    - Pass `authenticatedUrl` down through `createBareMirror()` and `updateBareMirror()`.
    - In `createBareMirror()`, replace the current `repoUrl.replace('https://', `https://x-access-token:${this.gitToken}@`)` logic with: `const mirrorCloneUrl = authenticatedUrl ?? repoUrl.replace('https://', `https://x-access-token:${this.gitToken}@`)`.
    - SECURITY: do NOT store `authenticatedUrl` in `MirrorMetadata` — only store the plain `repoUrl` in `metadata.repositoryUrl`.
  - [ ] In the call sites that invoke `gitMirrorService.getOrCreateMirror()` (currently in the AI providers / `WorkspaceService`), resolve token before calling mirror service and pass `resolvedAuth?.authenticatedUrl` as the second argument.

- [x] **Task 4: Update `GitHubModule` exports** (AC: #1)
  - [ ] In `src/github/github.module.ts`:
    - Add `GitHubTokenResolverService` to `providers: [...]`.
    - Add `GitHubTokenResolverService` to `exports: [...]` so it can be injected into `GItMirrorModule` (or any module that imports `GitHubModule`).

- [x] **Task 5: Unit Tests for `GitHubTokenResolverService`** (AC: #7)
  - [ ] Create `src/github/github-token-resolver.service.spec.ts`:
    - **Test 1 — Happy path:** Mock `prisma.project.findUnique` returns `{ github_account_id: 'acct-uuid' }`. Mock `prisma.gitHubAccount.findUnique` returns `{ id: 'acct-uuid', username: 'octocat', accessToken: '<encrypted>' }`. Mock `encryption.decrypt` returns `'ghp_token'`. Assert returned `authenticatedUrl` contains `x-access-token:ghp_token@github.com`. Assert `username === 'octocat'`.
    - **Test 2 — No account ID (null):** Mock project with `github_account_id: null`. Assert returns `null`. Assert no call to `gitHubAccount.findUnique`. Assert no call to `encryption.decrypt`.
    - **Test 3 — Account deleted:** Mock project with non-null `github_account_id`. Mock `gitHubAccount.findUnique` returns `null`. Assert throws `NotFoundException`.
    - **Test 4 — Decryption failure:** Mock account found but `encryption.decrypt` throws. Assert error propagates with original message.
    - **SECURITY Test 5 — No token in logs:** Spy on `logger.log` and `logger.warn`. Assert no logged string contains the mock decrypted token `'ghp_token'`.

## Dev Notes

### Architecture & Technical Requirements

- **Backend path:** `/Volumes/Data/project/products/alpharages/Dark Software Factory/src/`
- **Module boundary:** `GitHubTokenResolverService` lives in `src/github/` alongside `GitHubAuthFlowService`. It is exported by `GitHubModule` and consumed by `GItHubModule` (commit orchestrator) and potentially `GitMirrorModule`.
- **`EncryptionService` location:** `src/common/encryption/encryption.service.ts` — provides `encrypt(plaintext: string): string` and `decrypt(ciphertext: string): string`. AES-256-GCM, IV prepended in ciphertext (`iv:tag:data` format).
- **`GitHubAuthFlowService.ts` patterns:** Study lines 74–101 for the existing encrypt/upsert pattern. The new `GitHubTokenResolverService` mirrors the inverse: `decrypt → build URL`.

### Critical Codebase Patterns

**Token URL Format:** The existing `GitMirrorService` (line 293–296) already uses `https://x-access-token:<token>@github.com/...` for authentication. The new service must produce URLs in the same format.

**`GitHubAuthFlowService` is NOT to be modified.** Token storage is its responsibility. Token retrieval for execution is `GitHubTokenResolverService`'s responsibility (single-responsibility).

**`GitHubCommitOrchestrator` — two push call sites:**

- Line 132: `this.gitOps.push(workspace.path, repositoryUrl, githubPush.branch_name)` — in the "no uncommitted changes" branch
- Line 362: `await this.gitOps.push(workspace.path, repositoryUrl, githubPush.branch_name)` — in `commitAndPushDirect()`

Both must use the authenticated URL. The `resolveForProject()` call should happen **once** in `commitAndPush()` and the result passed down to `commitAndPushDirect()` as a parameter so there's no double DB query.

**NEVER embed `authenticatedUrl` in:**

- `AuditLog` entries (use the plain `repositoryUrl` / `githubPush.repository`)
- `GitHubPush.repository` column
- `MirrorMetadata.repositoryUrl`
- Any `this.logger.*()` call

**Prisma schema after Story 24-2:** `Project` model has `github_account_id String? @map("github_account_id")` and a relation to `GitHubAccount`. `GitHubAccount.accessToken` is the AES-encrypted token. These fields must exist before this story can be implemented — confirm Story 24-2 migration ran: `npx prisma migrate status`.

**Module dependency order:** Check that `GitHubModule` is imported into `GItMirrorModule` (or the relevant module) under NestJS's DI system. Use `@Module({ imports: [GitHubModule] })` — do NOT use `forwardRef()` unless a circular dependency actually exists.

**`installationId` context (from Story 24-1):** For OAuth-only accounts (no GitHub App), `installationId` is stored as `user_<ghUserId>`. The OAuth `accessToken` with `repo` scope is always what's stored, regardless of installation type. The token resolver does not care about `installationId` — it only needs `accessToken`.

### Key File Locations

```
Backend (NEW):
  src/github/github-token-resolver.service.ts       ← NEW
  src/github/github-token-resolver.service.spec.ts  ← NEW

Backend (MODIFY):
  src/github/github.module.ts                                         ← ADD provider + export
  src/github/services/github-commit-orchestrator.service.ts           ← ADD token injection for push
  src/git-mirror/git-mirror.service.ts                                ← ADD optional authenticatedUrl param
  src/git-mirror/git-mirror.module.ts                                 ← ADD GitHubModule to imports
```

### Previous Story Intelligence (from Story 24-2)

- `GitHubAuthFlowService.getReposForAccount()` was added in 24-2 and demonstrates the exact decrypt pattern: `const token = this.encryption.decrypt(account.accessToken)` followed by `new Octokit({ auth: token })`. The new resolver follows the same pattern.
- Story 24-2 added `ProjectRepository.updateGithubRepo()` which performs the DB write for `github_account_id`. By the time this story runs, the schema migration `add_project_github_account` has already been applied.
- The `GitHubAuthFlowController` is NOT the right place for token resolution — it handles OAuth flows for connected accounts. Keep resolving logic in `GitHubTokenResolverService`.

### Key Story References

- Epic 24 Story 24-3: `_bmad-output/planning-artifacts/epics.md` line 523
- Story 24-1 (patterns): `_bmad-output/implementation-artifacts/24-1-github-app-flow-for-multiple-accounts.md`
- Story 24-2 (schema + service): `_bmad-output/implementation-artifacts/24-2-repository-selector-in-project-setup.md`
- `GitHubAuthFlowService`: `src/github/github-auth-flow.service.ts`
- `GitMirrorService`: `src/git-mirror/git-mirror.service.ts` (token injection at lines 293-296, 373-376)
- `GitHubCommitOrchestrator`: `src/github/services/github-commit-orchestrator.service.ts` (push at lines 132, 362)
- `EncryptionService`: `src/common/encryption/encryption.service.ts`
- `PrismaService`: `src/database/prisma.service.ts`
- NFR-S4 (no plaintext secrets in logs): `_bmad-output/planning-artifacts/epics.md` line 252
- NFR-S11 (fine-grained tokens): `_bmad-output/planning-artifacts/epics.md` line 259

## Dev Agent Record

### Agent Model Used

Antigravity

### Debug Log References

### Completion Notes List

- Addressed code review feedback (AI):
  - Fixed security vulnerability in `GitOperationsService` where token-injected URLs were logged in plaintext. Reused the `sanitizeGitArgs` and `sanitizeErrorMessage` strategy from `GitMirrorService`.
  - Added test coverage in `src/ai-routing/providers/git-operations.service.spec.ts` for credential sanitization.
  - Documented changed files under File List.

### File List

- `src/github/github-token-resolver.service.ts`
- `src/github/github-token-resolver.service.spec.ts`
- `src/github/github.module.ts`
- `src/github/services/github-commit-orchestrator.service.ts`
- `src/git-mirror/git-mirror.service.ts`
- `src/ai-routing/providers/workspace.service.ts`
- `src/ai-routing/providers/workspace.service.spec.ts`
- `src/ai-routing/providers/git-operations.service.ts`
- `src/ai-routing/providers/git-operations.service.spec.ts`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
