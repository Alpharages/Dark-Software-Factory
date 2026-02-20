# Story 24.2: Repository Selector in Project Setup

Status: ready-for-dev

## Story

As a PM,
I want to select a specific repository from my connected GitHub accounts for a project,
so the orchestrator knows where to commit code.

## Acceptance Criteria

1. **GitHub Account Selector:** The Project settings page provides a dropdown listing all of the PM's connected GitHub accounts (fetched from `GET /api/v1/github/accounts`).
2. **Repository List:** After selecting a GitHub account, the UI fetches and displays accessible repositories for that account (`GET /api/v1/github/accounts/:accountId/repos`).
3. **Save Selection:** The PM can select a repository; the `repositoryFullName` (e.g., `owner/repo`) AND `githubAccountId` are saved to the project via `PATCH /api/v1/projects/:id/github-repo`.
4. **Schema Migration:** `Project` model gains `github_account_id String? @map("github_account_id")` (FK to `GitHubAccount`) and `GitHubAccount` gains `projects Project[]` inverse relation.
5. **Data Persistence:** Subsequent `GET /api/v1/projects/:id` returns `githubAccountId` and `githubRepositoryUrl` reflecting saved values.
6. **Security:** Token decryption happens server-side using `EncryptionService`. Raw token MUST NOT be logged (NFR-S4).
7. **Error Handling:** GitHub API failures (invalid token, rate limit) return `502 Bad Gateway` from backend. Frontend shows error toast.

## Tasks / Subtasks

- [ ] **Task 1: Database Schema Migration** (AC: #4)
  - [ ] Add to `Project` model in `prisma/schema.prisma`:
    ```prisma
    github_account_id String?         @map("github_account_id")
    gitHubAccount     GitHubAccount?  @relation(fields: [github_account_id], references: [id], onDelete: SetNull)
    @@index([github_account_id])
    ```
  - [ ] Add to `GitHubAccount` model: `projects Project[]`
  - [ ] Run: `npx prisma migrate dev --name add_project_github_account`
  - [ ] Run: `npx prisma generate`

- [ ] **Task 2: Backend — Repository Listing Endpoint** (AC: #2, #6, #7)
  - [ ] Add method `getReposForAccount(accountId: string, userId: string)` to **`GitHubAuthFlowService`** (`src/github/github-auth-flow.service.ts`):
    - Fetch `GitHubAccount` via `this.prisma.gitHubAccount.findUnique({ where: { id: accountId } })`.
    - If not found or `account.userId !== userId`, throw `ForbiddenException('Not your account')`.
    - Decrypt: `const token = this.encryption.decrypt(account.accessToken)`.
    - Use **existing `Octokit`** (already imported in this file): `const octokit = new Octokit({ auth: token })`.
    - Call: `const { data } = await octokit.repos.listForAuthenticatedUser({ per_page: 100, type: 'all' })`.
    - Map response: `data.map(r => ({ id: r.id, fullName: r.full_name, private: r.private, htmlUrl: r.html_url }))`.
    - On any GitHub API error (non-2xx / Octokit error), catch and throw `new HttpException('GitHub API error: ' + err.message, 502)`.
  - [ ] Add `GET accounts/:accountId/repos` to **`GitHubAuthFlowController`**:
    ```typescript
    @UseGuards(JwtAuthGuard)
    @Get('accounts/:accountId/repos')
    async getRepos(
      @Param('accountId') accountId: string,
      @Req() req: Request & { user: { id: string } },
    ) {
      return this.authFlowService.getReposForAccount(accountId, req.user.id);
    }
    ```

- [ ] **Task 3: Backend — Save GitHub Repo to Project** (AC: #3, #5)
  - [ ] Create `src/projects/dto/update-github-repo.dto.ts`:
    ```typescript
    import { IsString, IsNotEmpty } from 'class-validator';
    import { ApiProperty } from '@nestjs/swagger';
    export class UpdateGithubRepoDto {
      @ApiProperty({ example: 'uuid-of-github-account' })
      @IsString()
      @IsNotEmpty()
      githubAccountId!: string;
      @ApiProperty({ example: 'owner/repo-name' })
      @IsString()
      @IsNotEmpty()
      repositoryFullName!: string;
    }
    ```
  - [ ] Add `updateGithubRepo(id: string, dto: UpdateGithubRepoDto)` to **`ProjectRepository`** (`src/projects/project.repository.ts`):
    ```typescript
    async updateGithubRepo(id: string, githubAccountId: string, repositoryUrl: string): Promise<Project> {
      const project = await this.prisma.project.update({
        where: { id },
        data: { github_account_id: githubAccountId, github_repository_url: repositoryUrl },
      });
      this.logger.log(`Updated GitHub repo for project ${id}`);
      return project;
    }
    ```
  - [ ] Add `updateGithubRepo(id: string, dto: UpdateGithubRepoDto)` to **`ProjectService`** (`src/projects/project.service.ts`) — calls `this.repository.updateGithubRepo(id, dto.githubAccountId, \`https://github.com/${dto.repositoryFullName}\`)` after `this.findOne(id)`.
  - [ ] Add endpoint to **`ProjectController`**:
    ```typescript
    @Patch(':id/github-repo')
    @Roles(Role.ADMIN, Role.MANAGER, Role.PM)
    @ApiOperation({ summary: 'Set GitHub account and repository for project' })
    updateGithubRepo(@Param('id') id: string, @Body() dto: UpdateGithubRepoDto) {
      return this.projectService.updateGithubRepo(id, dto);
    }
    ```

- [ ] **Task 4: Frontend — Extend `githubApi.ts`** (AC: #2, #3)
  - [ ] Add to **`src/api/githubApi.ts`** (the existing dedicated GitHub API module — do NOT create a new axios instance):
    ```typescript
    export interface GitHubRepo {
      id: number;
      fullName: string;
      private: boolean;
      htmlUrl: string;
    }
    export async function getGithubRepos(accountId: string): Promise<GitHubRepo[]> {
      const { data } = await api.get(`/github/accounts/${accountId}/repos`);
      return data;
    }
    export async function saveProjectGithubRepo(
      projectId: string,
      payload: { githubAccountId: string; repositoryFullName: string },
    ): Promise<void> {
      await api.patch(`/projects/${projectId}/github-repo`, payload);
    }
    ```
  - [ ] Add TanStack Query hook `useGithubRepos(accountId: string | null)` in `src/hooks/queries/useGithubAccounts.ts` (collocate with existing `useGithubAccounts` hook — same file):
    ```typescript
    export function useGithubRepos(accountId: string | null) {
      return useQuery({
        queryKey: [...githubKeys.all, 'repos', accountId],
        queryFn: () => getGithubRepos(accountId!),
        enabled: !!accountId,
        staleTime: 30 * 1000,
      });
    }
    ```

- [ ] **Task 5: Frontend — `GithubRepoSelector` Component** (AC: #1, #2, #3, #7)
  - [ ] Create `dsf-dashboard/src/components/projects/GithubRepoSelector.tsx`.
  - [ ] Props: `projectId: string`, `currentAccountId?: string | null`, `currentRepoUrl?: string | null`.
  - [ ] Use `useGithubAccounts()` for account dropdown (shadcn/ui `Select`). Show `account.username` as label.
  - [ ] `selectedAccountId` state: initialize to `currentAccountId ?? null`.
  - [ ] Use `useGithubRepos(selectedAccountId)` for repo dropdown. Show `Skeleton` while `isLoading`. Indicate private repos with `Lock` icon (lucide-react).
  - [ ] "Save" button calls `saveProjectGithubRepo()` then shows toast via `useToast()`.
  - [ ] On `saveProjectGithubRepo` error, show descriptive error toast.
  - [ ] Invalidate relevant query cache after save (`queryClient.invalidateQueries`).

- [ ] **Task 6: Frontend — Integrate into Project Page** (AC: #1)
  - [ ] Find the project detail/settings page — check `ProjectsTable.tsx` and `ProjectCard.tsx` for navigation patterns, or look for a route matching `/projects/:id`.
  - [ ] Add a "GitHub Repository" settings section and render `<GithubRepoSelector projectId={project.id} currentAccountId={project.githubAccountId} currentRepoUrl={project.githubRepositoryUrl} />`.
  - [ ] Ensure the TypeScript `Project` type/interface used in the frontend includes `githubAccountId?: string | null`.

- [ ] **Task 7: Unit Tests** (AC: all)
  - [ ] Jest tests for `GitHubAuthFlowService.getReposForAccount()`:
    - Mock `PrismaService`, `EncryptionService`, and `Octokit`.
    - Test: returns repo list on success (decrypt called once, Octokit called with decrypted token).
    - Test: throws `ForbiddenException` on userId mismatch.
    - Test: throws `HttpException(502)` on Octokit/GitHub API failure.
  - [ ] Jest test for `ProjectRepository.updateGithubRepo()` (mock `PrismaService`).

## Dev Notes

### Architecture & Technical Requirements

- **Backend:** NestJS at `/Volumes/Data/project/products/alpharages/Dark Software Factory/`.
- **Frontend:** React + TypeScript + shadcn/ui (Tailwind v4) at `/Volumes/Data/project/products/alpharages/dsf-dasbhoard/`.
- **API Versioning:** All endpoints use `/api/v1/` prefix per ADR-018.
- **Authentication:** All endpoints protected by `JwtAuthGuard`. Repo endpoint must verify `account.userId === req.user.id`.
- **Octokit is already installed and imported** in `github-auth-flow.service.ts` line 5. Use `Octokit` from `@octokit/rest` — do NOT use raw axios for GitHub API calls.
- **Token security:** `EncryptionService` (`src/common/encryption/encryption.service.ts`) provides `encrypt()`/`decrypt()`. **Never log the decrypted token** (NFR-S4).

### Critical Codebase Patterns

**Backend Repository Pattern:** `ProjectService` routes ALL database writes through `ProjectRepository` (`src/projects/project.repository.ts`). Do NOT use `this.prisma.project.update()` directly in `ProjectService` — add a new method to `ProjectRepository` instead. See `updateRepository()` and `updateStatus()` as examples.

**`GitHubAuthFlowService` is NOT exported from `github.module.ts`.** Both the new repo listing endpoint and the existing accounts endpoint live inside `GitHubAuthFlowController`. The project save endpoint (`PATCH /projects/:id/github-repo`) is handled separately in `ProjectController`/`ProjectService` and does NOT need to call `GitHubAuthFlowService` — it only writes IDs to the DB.

**Frontend API Pattern:** All GitHub API calls go through `src/api/githubApi.ts` which has a shared axios instance: `axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api/v1', withCredentials: true })`. Extend this file — do NOT create a new axios instance or separate API file.

**Frontend Query Pattern:** GitHub query hooks live in `src/hooks/queries/useGithubAccounts.ts`. Add `useGithubRepos` hook in the same file alongside `useGithubAccounts`.

**Controller Role Guards:** The existing `PATCH /projects/:id/repository` uses `@Roles(Role.ADMIN, Role.MANAGER)`. For the new endpoint, include `Role.PM` since PMs assign repos for their own projects.

### Prisma Field Naming

Prisma field names use `camelCase` in TypeScript but `snake_case` in the DB (via `@map`). The migration will create `github_account_id` column in the `projects` table. After migration, `prisma.project.update({ data: { github_account_id: ... } })` is correct.

### Known Issue from Story 24-1 (Relevant Context)

The `installationId` for OAuth-only accounts (no App installation) is stored as `user_<ghUserId>` string (see `github-auth-flow.service.ts` line 71). This means `octokit.repos.listForAuthenticatedUser()` is the correct endpoint (user OAuth token, `repo` scope), NOT `GET /app/installations/{id}/access_tokens`. Confirm the token's `repo` scope during testing.

### Project Structure Notes

```
Backend:
  src/github/github-auth-flow.controller.ts  ← ADD: GET accounts/:accountId/repos
  src/github/github-auth-flow.service.ts     ← ADD: getReposForAccount()
  src/projects/dto/update-github-repo.dto.ts ← NEW
  src/projects/project.repository.ts         ← ADD: updateGithubRepo()
  src/projects/project.service.ts            ← ADD: updateGithubRepo()
  src/projects/project.controller.ts         ← ADD: PATCH :id/github-repo
  prisma/schema.prisma                       ← MODIFY: Project + GitHubAccount models

Frontend (dsf-dasbhoard):
  src/api/githubApi.ts                       ← ADD: getGithubRepos(), saveProjectGithubRepo()
  src/hooks/queries/useGithubAccounts.ts     ← ADD: useGithubRepos() hook
  src/components/projects/GithubRepoSelector.tsx ← NEW
  src/pages/ or src/components/projects/[project detail component] ← MODIFY: add selector
```

### References

- Epic 24 Story 24-2: `_bmad-output/planning-artifacts/epics.md` line 511
- Story 24-1 (patterns): `_bmad-output/implementation-artifacts/24-1-github-app-flow-for-multiple-accounts.md`
- FRs: FR146-FR149, NFR-S3, NFR-S11, NFR-S4 (`_bmad-output/planning-artifacts/prd.md`)
- `GitHubAuthFlowService`: `src/github/github-auth-flow.service.ts`
- `GitHubAuthFlowController`: `src/github/github-auth-flow.controller.ts`
- `ProjectRepository`: `src/projects/project.repository.ts`
- `ProjectService`: `src/projects/project.service.ts`
- `ProjectController`: `src/projects/project.controller.ts`
- Prisma schema: `prisma/schema.prisma` (Project model line 9, GitHubAccount model line 1243)
- Frontend API: `dsf-dasbhoard/src/api/githubApi.ts` (axios instance with `VITE_API_URL || /api/v1`)
- Frontend hooks: `dsf-dasbhoard/src/hooks/queries/useGithubAccounts.ts`
- Frontend component pattern: `dsf-dasbhoard/src/components/profile/GithubAccountsList.tsx`
- EncryptionService: `src/common/encryption/encryption.service.ts`

## Dev Agent Record

### Agent Model Used

Antigravity

### Debug Log References

### Completion Notes List

### File List
