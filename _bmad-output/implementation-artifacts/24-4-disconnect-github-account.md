# Story 24.4: Disconnect GitHub Account

Status: done

## Story

As a PM,
I want to disconnect (remove) a connected GitHub account from my profile,
so that I can revoke DSF's access to an account I no longer use and keep my connected accounts clean.

## Acceptance Criteria

1. **DELETE endpoint exists:** `DELETE /api/v1/github/accounts/:accountId` is protected by `JwtAuthGuard` and returns `{ message: string; affectedProjects: number }`.
2. **Ownership guard:** The endpoint throws `ForbiddenException` if the authenticated user does not own the specified account. It never deletes another user's account.
3. **Account not found:** If `accountId` does not exist in `github_accounts`, the endpoint throws `NotFoundException` with a clear message.
4. **Cascade to projects:** Upon deletion, all `projects` rows whose `github_account_id` matches the deleted account have that field set to `null` automatically (enforced by the existing `onDelete: SetNull` Prisma constraint — no manual update query required).
5. **Response payload:** The response includes `affectedProjects` (count of projects that had their `github_account_id` nulled) so the frontend can display an informative message.
6. **UI — Disconnect button:** Each connected account card in `GithubAccountsList` shows a "Disconnect" button (destructive, trash icon). Clicking it opens an `AlertDialog` confirmation.
7. **UI — Confirmation dialog:** The `AlertDialog` states the account username and warns: _"Any projects linked to this account will lose their GitHub connection and must be reconfigured."_ It has **Cancel** and **Disconnect** (destructive) actions.
8. **UI — Loading state:** The Disconnect button shows a spinner (`Loader2`) and is disabled while the mutation is pending; no double-submit possible.
9. **UI — Success feedback:** After deletion, the accounts list auto-refreshes (TanStack Query invalidation) and a success toast is shown: _"@username disconnected. X project(s) affected."_ (or _"No projects were affected."_ if zero).
10. **UI — Error feedback:** If the API call fails, a `toast.error()` with the server error message (or fallback) is displayed; the dialog stays open so the user can retry.
11. **Unit tests (backend):** `GitHubAuthFlowService.disconnectAccount()` has Jest tests covering: happy path (deletes, returns count), ownership violation (throws `ForbiddenException`), and account not found (throws `NotFoundException`).

## Tasks / Subtasks

### Backend

- [x] **Task 1: Add `disconnectAccount()` to `GitHubAuthFlowService`** (AC: #1–5, #11)
  - [x] In `src/github/github-auth-flow.service.ts`, add the method:

    ```typescript
    async disconnectAccount(
      accountId: string,
      userId: string,
    ): Promise<{ message: string; affectedProjects: number }> {
      const account = await this.prisma.gitHubAccount.findUnique({
        where: { id: accountId },
        include: { projects: { select: { id: true } } },
      });

      if (!account) {
        throw new NotFoundException(`GitHub account ${accountId} not found.`);
      }

      if (account.userId !== userId) {
        throw new ForbiddenException('You do not own this GitHub account.');
      }

      const affectedProjects = account.projects.length;

      await this.prisma.gitHubAccount.delete({ where: { id: accountId } });

      this.logger.log(
        `GitHub account ${accountId} (${account.username}) disconnected by user ${userId}. ` +
          `${affectedProjects} project(s) affected.`,
      );

      return {
        message: `GitHub account @${account.username} disconnected successfully.`,
        affectedProjects,
      };
    }
    ```

  - [x] Add `NotFoundException` to the import from `@nestjs/common` at the top of the file (alongside existing `ForbiddenException`, `HttpException`).

- [x] **Task 2: Add `DELETE /github/accounts/:accountId` to `GitHubAuthFlowController`** (AC: #1)
  - [x] In `src/github/github-auth-flow.controller.ts`, add `Delete, ParseUUIDPipe` to the existing `@nestjs/common` import line (`NotFoundException` is NOT needed in the controller — it's only used in the service).
  - [x] Add a `@nestjs/swagger` import (new import line — this file currently has no Swagger imports):
    ```typescript
    import { ApiTags, ApiBearerAuth, ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';
    ```
  - [x] Add `@ApiTags('GitHub')` and `@ApiBearerAuth()` to the **controller class** (above `@Controller('github')`):
    ```typescript
    @ApiTags('GitHub')
    @ApiBearerAuth()
    @Controller('github')
    export class GitHubAuthFlowController {
    ```
  - [x] Add the handler with full Swagger decorators:

    ```typescript
    @UseGuards(JwtAuthGuard)
    @Delete('accounts/:accountId')
    @ApiOperation({ summary: 'Disconnect a connected GitHub account' })
    @ApiParam({ name: 'accountId', description: 'GitHub Account UUID' })
    @ApiResponse({ status: 200, description: 'Account disconnected successfully' })
    @ApiResponse({ status: 401, description: 'Not authenticated' })
    @ApiResponse({ status: 403, description: 'Account belongs to a different user' })
    @ApiResponse({ status: 404, description: 'GitHub account not found' })
    async disconnectAccount(
      @Param('accountId', ParseUUIDPipe) accountId: string,
      @Req() req: Request & { user: { id: string } },
    ) {
      return this.authFlowService.disconnectAccount(accountId, req.user.id);
    }
    ```

- [x] **Task 3: Unit tests for `disconnectAccount()`** (AC: #11)
  - [x] In `src/github/github-auth-flow.service.spec.ts`, add a `describe('disconnectAccount', ...)` block:
    - **Test 1 — Happy path:** Mock `prisma.gitHubAccount.findUnique` returns account with `userId === 'user-1'` and `projects: [{ id: 'p1' }, { id: 'p2' }]`. Mock `prisma.gitHubAccount.delete` resolves. Assert returns `{ message: ..., affectedProjects: 2 }`. Assert `delete` called with `{ where: { id: 'acc-1' } }`.
    - **Test 2 — No linked projects:** Same as above but `projects: []`. Assert `affectedProjects === 0`.
    - **Test 3 — Ownership violation:** Mock account exists with `userId: 'other-user'`. Assert throws `ForbiddenException`. Assert `delete` is never called.
    - **Test 4 — Account not found:** Mock `findUnique` returns `null`. Assert throws `NotFoundException`. Assert `delete` is never called.
  - [x] Update the `mockPrisma` object in the existing `beforeEach` to also include `delete: jest.fn()` on the `gitHubAccount` mock:
    ```typescript
    gitHubAccount: {
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
    ```

### Frontend

- [x] **Task 4: Add `deleteGithubAccount()` API function** (AC: #1)
  - [x] In `src/api/githubApi.ts`, add at the end:

    ```typescript
    export interface DisconnectAccountResponse {
      message: string;
      affectedProjects: number;
    }

    /**
     * Disconnects (deletes) a connected GitHub account for the current user.
     */
    export async function deleteGithubAccount(
      accountId: string,
    ): Promise<DisconnectAccountResponse> {
      const { data } = await api.delete(`/github/accounts/${accountId}`);
      return data;
    }
    ```

- [x] **Task 5: Add `useDeleteGithubAccount` mutation hook** (AC: #9, #10)
  - [x] In `src/hooks/queries/useGithubAccounts.ts`, update the `@tanstack/react-query` import to include `useMutation, useQueryClient` alongside the existing `useQuery`. Also add `deleteGithubAccount` and the `type DisconnectAccountResponse` to the `@/api/githubApi` import (follow existing inline `type` annotation pattern already used in this file):
    ```typescript
    import {
      useQuery,
      useMutation,
      useQueryClient,
      type UseQueryOptions,
    } from '@tanstack/react-query';
    import {
      getGithubAccounts,
      getGithubRepos,
      deleteGithubAccount,
      type GitHubAccount,
      type GitHubRepo,
      type DisconnectAccountResponse,
    } from '@/api/githubApi';
    ```
  - [x] Add the hook after the existing query hooks. Error is typed as `AxiosError<{ message: string }>` — import `AxiosError` from `axios`:

    ```typescript
    import type { AxiosError } from 'axios';

    export function useDeleteGithubAccount() {
      const queryClient = useQueryClient();
      return useMutation<DisconnectAccountResponse, AxiosError<{ message: string }>, string>({
        mutationFn: deleteGithubAccount,
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: githubKeys.accounts() });
        },
      });
    }
    ```

- [x] **Task 6: Update `GithubAccountsList` with disconnect UI** (AC: #6–10)
  - [x] In `src/components/profile/GithubAccountsList.tsx`, replace the entire file content with the implementation below. The key additions are:
    - Import `AlertDialog` components from `@/components/ui/alert-dialog`
    - Import `Trash2, Loader2` from `lucide-react`
    - Import `toast` from `react-hot-toast`
    - Import `useDeleteGithubAccount` from `@/hooks/queries/useGithubAccounts`
    - Add per-account disconnect button that opens `AlertDialog`
    - Call `mutation.mutate(account.id)` on confirmation
    - Handle `onSuccess` / `onError` with toast inside the component
  - [x] Final component shape:

    ```tsx
    import React, { useState } from 'react';
    import { useGithubAccounts, useDeleteGithubAccount } from '@/hooks/queries/useGithubAccounts';
    import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card';
    import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
    import { Button } from '@/components/ui/button';
    import {
      AlertDialog,
      AlertDialogAction,
      AlertDialogCancel,
      AlertDialogContent,
      AlertDialogDescription,
      AlertDialogFooter,
      AlertDialogHeader,
      AlertDialogTitle,
    } from '@/components/ui/alert-dialog';
    import { Github, ExternalLink, Loader2, Trash2 } from 'lucide-react';
    import { toast } from 'react-hot-toast';
    import { formatDistanceToNow } from 'date-fns';
    import type { GitHubAccount } from '@/api/githubApi';

    export const GithubAccountsList: React.FC = () => {
      const { data: accounts, isLoading, error } = useGithubAccounts();
      const deleteMutation = useDeleteGithubAccount();
      const [pendingDeleteAccount, setPendingDeleteAccount] = useState<GitHubAccount | null>(null);

      const handleConfirmDisconnect = () => {
        if (!pendingDeleteAccount) return;
        const username = pendingDeleteAccount.username;
        deleteMutation.mutate(pendingDeleteAccount.id, {
          onSuccess: (result) => {
            const projectMsg =
              result.affectedProjects > 0
                ? `${result.affectedProjects} project(s) affected.`
                : 'No projects were affected.';
            toast.success(`@${username} disconnected. ${projectMsg}`);
            setPendingDeleteAccount(null);
          },
          onError: (err) => {
            // Extract server-side message from response body; fall back to Axios-level message
            const serverMsg = err.response?.data?.message;
            toast.error(
              serverMsg || err.message || 'Failed to disconnect account. Please try again.',
            );
          },
        });
      };

      if (isLoading) {
        return (
          <div className="flex items-center justify-center p-8">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        );
      }

      if (error) {
        return (
          <div className="p-4 bg-destructive/10 text-destructive rounded-lg">
            Failed to load connected accounts.
          </div>
        );
      }

      return (
        <>
          <div className="space-y-4">
            <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              Connected GitHub Accounts
            </h4>

            {accounts?.length === 0 ? (
              <Card className="border-dashed bg-muted/30">
                <CardContent className="flex flex-col items-center justify-center py-8 text-center">
                  <Github className="w-10 h-10 text-muted-foreground mb-4 opacity-50" />
                  <CardTitle className="text-sm font-medium">No accounts connected</CardTitle>
                  <CardDescription className="text-xs">
                    Personal access tokens are no longer supported for multi-account management.
                  </CardDescription>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4">
                {accounts?.map((account) => (
                  <Card
                    key={account.id}
                    className="overflow-hidden bg-card/50 backdrop-blur-sm border-border/50 hover:border-primary/50 transition-colors"
                  >
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <Avatar className="h-10 w-10 border border-border shadow-sm">
                            <AvatarImage src={account.avatarUrl} alt={account.username} />
                            <AvatarFallback>
                              {account.username.substring(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="font-bold text-foreground">{account.username}</p>
                              <span className="px-1.5 py-0.5 rounded text-[10px] bg-primary/10 text-primary font-bold uppercase">
                                App v1
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              Connected {formatDistanceToNow(new Date(account.updatedAt))} ago
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <a
                            href={`https://github.com/${account.username}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-2 hover:bg-secondary rounded-full transition-colors"
                          >
                            <ExternalLink className="h-4 w-4 text-muted-foreground" />
                          </a>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                            onClick={() => setPendingDeleteAccount(account)}
                            disabled={deleteMutation.isPending}
                            aria-label={`Disconnect ${account.username}`}
                          >
                            {deleteMutation.isPending && pendingDeleteAccount?.id === account.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>

          <AlertDialog
            open={!!pendingDeleteAccount}
            onOpenChange={(open) => {
              if (!open) setPendingDeleteAccount(null);
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Disconnect @{pendingDeleteAccount?.username}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will remove DSF&apos;s access to the{' '}
                  <span className="font-semibold">@{pendingDeleteAccount?.username}</span> GitHub
                  account. Any projects linked to this account will lose their GitHub connection and
                  must be reconfigured.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={handleConfirmDisconnect}
                  disabled={deleteMutation.isPending}
                >
                  {deleteMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Disconnecting…
                    </>
                  ) : (
                    'Disconnect'
                  )}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      );
    };
    ```

## Dev Notes

### Architecture & Technical Requirements

**Backend path:** `src/github/`
**Frontend path:** `src/components/profile/` and `src/hooks/queries/` and `src/api/`

### Prisma Cascade — Critical

The `Project` model in `prisma/schema.prisma` (line 33) already has:

```prisma
gitHubAccount GitHubAccount? @relation(fields: [github_account_id], references: [id], onDelete: SetNull)
```

This means `prisma.gitHubAccount.delete()` **automatically** sets `project.github_account_id = null` on all linked projects. **No manual `updateMany` is needed.** The `include: { projects: { select: { id: true } } }` in `findUnique` is only to count affected projects for the response — do NOT also issue a manual `updateMany`.

### Ownership check pattern

Follow the exact same ownership guard used in `getReposForAccount()` (service line 158):

```typescript
if (!account || account.userId !== userId) {
  throw new ForbiddenException('Not your account');
}
```

For `disconnectAccount`, we split this into a NotFoundException (not found) and ForbiddenException (wrong owner) for more precise HTTP semantics.

### Controller pattern

Current controller (`github-auth-flow.controller.ts`) imports `Get, Post, Body, Query, UseGuards, Req, Logger, Param` from `@nestjs/common`. Add `Delete, ParseUUIDPipe` to that import. **Do NOT add `NotFoundException` to the controller** — it is only used in the service.

The controller currently has **zero Swagger decorators** at class or method level. Task 2 adds `@ApiTags('GitHub')` and `@ApiBearerAuth()` to the class and the standard `@ApiOperation`/`@ApiResponse`/`@ApiParam` decorators to the new endpoint, consistent with every other DELETE handler in the codebase (`project.controller.ts`, `users.controller.ts`, etc.).

The `@Req() req: Request & { user: { id: string } }` pattern is already established in the existing handlers — use the same type.

### Module — No changes needed

`GitHubModule` already has `GitHubAuthFlowService` as a provider and `GitHubAuthFlowController` as a controller. No changes to `github.module.ts` are required for this story.

### Frontend — AlertDialog usage

`alert-dialog.tsx` is present at `src/components/ui/alert-dialog.tsx`. Import path: `@/components/ui/alert-dialog`. The component is already used elsewhere in the codebase — follow the same pattern (e.g., search for `AlertDialogAction` usage in the project for reference examples).

### Frontend — Query invalidation

After a successful delete, `useDeleteGithubAccount` calls:

```typescript
queryClient.invalidateQueries({ queryKey: githubKeys.accounts() });
```

This triggers a re-fetch of `GET /github/accounts` and the list updates automatically. Do **not** manually filter the local state — let React Query handle it.

### Frontend — Toast pattern

Use `react-hot-toast` (already imported in `ConnectGithubButton.tsx`):

```typescript
import { toast } from 'react-hot-toast';
toast.success('...');
toast.error('...');
```

### Frontend — Error message extraction

The server's descriptive error message is in `err.response?.data?.message` (the JSON body from NestJS's `HttpExceptionFilter`). `err.message` is the Axios-level string (e.g., `"Request failed with status code 404"`) — not the server's message. Always extract in this order:

```typescript
const serverMsg = err.response?.data?.message;
toast.error(serverMsg || err.message || 'Failed to disconnect account.');
```

The hook types the error as `AxiosError<{ message: string }>` so `err.response?.data?.message` is fully typed with no cast needed.

### Frontend — 403 is intercepted globally, `onError` will NOT run

`src/api/client.ts` intercepts every `403 Forbidden` response: it shows its own toast (`"You don't have permission to access this resource"`) and **redirects to `/forbidden`** before the promise rejects to the mutation's `onError`. In practice this case cannot be hit by a legitimate user (the backend ownership check uses the JWT-extracted `userId`, so a user can never accidentally delete someone else's account). But do not add any 403-specific logic in `onError` — it will never execute.

### Frontend — `AlertDialogTrigger` is not available

The custom `src/components/ui/alert-dialog.tsx` does **not** export `AlertDialogTrigger`. It only supports the controlled state pattern (`open` / `onOpenChange` props). Do not attempt a trigger-based pattern — use `useState<GitHubAccount | null>` as the open state, exactly as implemented in `NotificationPreferences.tsx` and `BulkActionsToolbar.tsx`.

### Frontend — TypeScript strict mode pitfalls

`tsconfig` has `"noUnusedLocals": true` and `"noUnusedParameters": true`. Key rules:

- Prefix any unused callback parameter with `_` (e.g., `_data`, `_variables`)
- The hook-level `onSuccess: () => { ... }` (no params declared) is valid — TypeScript allows fewer params than the callback type requires
- `verbatimModuleSyntax: true` is active — type-only imports must use the inline `type` keyword: `import { type Foo }` not `import type { Foo }` (see existing `useGithubAccounts.ts` imports as the reference pattern)

### File Structure

```
Backend (MODIFY):
  src/github/github-auth-flow.service.ts          ← ADD disconnectAccount(), NotFoundException import
  src/github/github-auth-flow.controller.ts        ← ADD DELETE endpoint, Delete+ParseUUIDPipe imports,
                                                       @nestjs/swagger import, @ApiTags/@ApiBearerAuth on class
  src/github/github-auth-flow.service.spec.ts      ← ADD disconnectAccount tests, delete mock

Frontend (MODIFY):
  src/api/githubApi.ts                              ← ADD deleteGithubAccount() + DisconnectAccountResponse
  src/hooks/queries/useGithubAccounts.ts            ← ADD useDeleteGithubAccount(), useMutation/useQueryClient
                                                       imports, AxiosError import
  src/components/profile/GithubAccountsList.tsx     ← ADD disconnect button + AlertDialog
```

### Project Structure Notes

- NestJS module for this feature: `src/github/github.module.ts` — no changes needed, `GitHubAuthFlowService` and `GitHubAuthFlowController` are already registered.
- Frontend feature scope: profile management. The `GithubAccountsList` component is rendered inside `ProfilePage` (`src/pages/ProfilePage.tsx`) — no routing or page-level changes required.
- This story does **not** touch the `GithubRepoSelector` component (`src/features/projects/components/GithubRepoSelector.tsx`). That component uses `useGithubAccounts()`, so it auto-refreshes when the accounts query is invalidated after disconnection — the deleted account will disappear from the project dropdown automatically. The project row still holds the now-nulled `github_account_id` in the DB (set to `null` by the `onDelete: SetNull` cascade). This means the project will show an empty GitHub account selection — the PM must pick a new account and save. This is the expected and correct UX; no additional code change is required here.

### Previous Story Intelligence

- **Story 24-1** established the `GitHubAccount` Prisma model and OAuth flow. The `installationId` uniqueness constraint does not affect deletion — `delete` by `id` (UUID PK) is sufficient.
- **Story 24-2** added `Project.github_account_id` with `onDelete: SetNull`. This story relies on that migration being applied.
- **Story 24-3** established `GitHubTokenResolverService` which throws `NotFoundException` when a linked account is deleted mid-execution. After this story, users can intentionally delete accounts — the NotFoundException from 24-3 still applies if execution is attempted after disconnection, which is the correct behavior.
- **Existing test structure in `github-auth-flow.service.spec.ts`:** The `mockPrisma` object currently only defines `gitHubAccount.findUnique`. Add `delete: jest.fn()` to the same object in `beforeEach` to support the new tests.

### Git Intelligence (Recent Commits)

- `202c6da feat: implement secure GitHub token resolution` — Added `GitHubTokenResolverService`. Follow the same service structure pattern.
- `97f6dd4 refactor: deduplicate token resolution logic` — Shows `commitAndPush` refactoring; not relevant to this story.
- `793c234 feat(tests): add E2E tests for v3 flow` — E2E tests are not required for this story; unit tests only.

### References

- Prisma schema `onDelete: SetNull`: `prisma/schema.prisma` line 33
- `GitHubAuthFlowService.getReposForAccount()` (ownership guard pattern): `src/github/github-auth-flow.service.ts:153–160`
- `GitHubAuthFlowController` (controller pattern): `src/github/github-auth-flow.controller.ts`
- Swagger decorator pattern (reference): `src/projects/project.controller.ts` (Delete with full decorators)
- `AlertDialog` controlled state pattern reference: `src/pages/NotificationPreferences.tsx`
- `AlertDialog` component exports: `src/components/ui/alert-dialog.tsx`
- `useMutation` + `onError` error extraction pattern: `src/hooks/useApprovals.ts`
- `client.ts` 403 interceptor (global redirect): `src/api/client.ts`
- `githubKeys` query keys: `src/hooks/queries/useGithubAccounts.ts:4–8`
- Toast pattern: `src/components/profile/ConnectGithubButton.tsx:5,16`
- Story 24-3 NotFoundException (execution impact): `_bmad-output/implementation-artifacts/24-3-execution-token-retrieval.md` AC#6
- NFR-S3 (least-privilege access): `_bmad-output/planning-artifacts/epics.md`

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

_No issues encountered during implementation._

### Completion Notes List

- Implemented `disconnectAccount()` in `GitHubAuthFlowService` with NotFoundException (not found) and ForbiddenException (wrong owner) separation for precise HTTP semantics.
- The Prisma `onDelete: SetNull` cascade handles nulling `project.github_account_id` automatically — no manual `updateMany` issued.
- Added `DELETE /api/v1/github/accounts/:accountId` with `ParseUUIDPipe` for input validation, protected by `JwtAuthGuard`.
- Added full Swagger decorators (`@ApiTags`, `@ApiBearerAuth`, `@ApiOperation`, `@ApiParam`, `@ApiResponse`) to controller class and new endpoint.
- 4 new unit tests: happy path, zero-project path, ownership violation (ForbiddenException, delete not called), account not found (NotFoundException, delete not called). All 8 tests (4 new + 4 existing) pass.
- Frontend: `deleteGithubAccount()` API function + `DisconnectAccountResponse` interface added to `githubApi.ts`.
- Frontend: `useDeleteGithubAccount` mutation hook added to `useGithubAccounts.ts` with TanStack Query cache invalidation on success.
- Frontend: `GithubAccountsList` updated with per-account Trash2 icon button, `AlertDialog` confirmation (controlled state via `useState<GitHubAccount | null>`), spinner loading state, success toast with project count, error toast with server message extraction.
- Backend: TypeScript strict mode passes (`tsc --noEmit` clean). ESLint passes with auto-fix (import formatting only).
- Frontend: No type errors in story-modified files. Pre-existing lint/type errors in unrelated files not introduced by this story.

### Code Review Fixes (2026-02-24)

- [H1] Added try/catch around `prisma.gitHubAccount.delete()` in `disconnectAccount()` with contextual error logging (`service.ts`).
- [H2] Added `findUnique` parameter assertions (`include` clause) to happy path and zero-project tests (`service.spec.ts`).
- [M3] Fixed `AlertDialog onOpenChange` to guard against closing while `deleteMutation.isPending` is true (`GithubAccountsList.tsx`).
- [M4] Upgraded Test 2 assertion from partial (`affectedProjects`) to full `toEqual` response shape check (`service.spec.ts`).
- [M5] Added `ParseUUIDPipe` to `getReposForAccount` endpoint to match `disconnectAccount` validation consistency (`controller.ts`).

### File List

**Backend (Modified):**

- `src/github/github-auth-flow.service.ts`
- `src/github/github-auth-flow.controller.ts`
- `src/github/github-auth-flow.service.spec.ts`

**Frontend (Modified):**

- `src/api/githubApi.ts`
- `src/hooks/queries/useGithubAccounts.ts`
- `src/components/profile/GithubAccountsList.tsx`

**Sprint Tracking (Modified):**

- `_bmad-output/implementation-artifacts/sprint-status.yaml`

## Change Log

- 2026-02-24: Implemented story 24-4 — Disconnect GitHub Account. Added `DELETE /api/v1/github/accounts/:accountId` backend endpoint with ownership guard and SetNull cascade. Added 4 unit tests covering happy path, zero-project count, ownership violation, and account not found. Added `deleteGithubAccount` API function and `useDeleteGithubAccount` mutation hook on frontend. Updated `GithubAccountsList` with Trash2 disconnect button, AlertDialog confirmation, spinner, and toast feedback.
