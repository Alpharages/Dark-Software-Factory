# Story 23.1: Local Git Mirror Service

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Performance Engineer,
I want the system to maintain a local "bare" cache of the target repository,
So that creating a new workspace takes milliseconds instead of seconds/minutes.

## Acceptance Criteria

1. **Given** a frequent repository (e.g., `alpharages/Dark Software Factory`)
   **When** a new AI task starts that requires this repository
   **Then** the system should check for an existing local bare mirror in the configured mirror directory
   **And** if present, clone from the local mirror to the workspace instead of fetching from GitHub.

2. **Given** a repository without a local mirror
   **When** the first task requiring this repository starts
   **Then** the system should fetch from GitHub and create a bare mirror first
   **And** subsequent tasks should use the local mirror for cloning.

3. **Given** a stale local mirror (older than configured TTL)
   **When** a task requires this repository
   **Then** the system should fetch updates from the remote to refresh the mirror
   **And** ensure the mirror is up-to-date before cloning to workspace.

4. **Given** a mirror update operation
   **When** fetching updates from GitHub
   **Then** the system should handle authentication properly (reuse existing GitHub auth flow)
   **And** fail gracefully with clear error messages if authentication fails.

5. **Given** the mirror service is running
   **When** disk space is running low
   **Then** the system should implement LRU (Least Recently Used) eviction
   **And** remove oldest mirrors when space falls below threshold.

6. **Given** mirror operations
   **When** metrics collection is enabled
   **Then** the system should track: mirror hit rate, clone time savings, mirror size, last update time
   **And** expose these metrics via Prometheus.

## Tasks / Subtasks

- [x] Task 1: Create GitMirrorService Module (AC: 1, 2, 4)
  - [x] Create `src/git-mirror/git-mirror.module.ts` with proper NestJS module structure
  - [x] Create `src/git-mirror/git-mirror.service.ts` with core mirror management logic
  - [x] Implement `getOrCreateMirror(repoUrl: string): Promise<MirrorInfo>` method
  - [x] Implement `cloneFromMirror(mirrorPath: string, targetPath: string): Promise<void>` method
  - [x] Add proper dependency injection for `GitHubAuthService` (reuse existing auth from `src/github/github-auth.service.ts`)
  - [x] Create `src/git-mirror/exceptions/git-mirror.exception.ts` with custom exceptions:
    - `GitMirrorException extends InfrastructureException`
    - `MirrorAuthError`, `MirrorNetworkError`, `MirrorCorruptedError`
    - Follow pattern from `src/github/exceptions/github.exceptions.ts`

- [x] Task 2: Bare Mirror Management (AC: 1, 2, 3)
  - [x] Implement `createBareMirror(owner: string, repo: string): Promise<string>` - creates bare clone from GitHub
  - [x] Implement `updateBareMirror(owner: string, repo: string): Promise<void>` - runs `git fetch --prune` in mirror
  - [x] Implement `isMirrorStale(lastUpdated: Date): boolean` - checks if mirror exceeds `GIT_MIRROR_TTL_HOURS`
  - [x] Implement metadata tracking via JSON file - tracks last update, size, hit count
  - [x] Store mirrors in configured directory: `${GIT_MIRROR_BASE_PATH}/{owner}/{repo}.git`

- [x] Task 3: Workspace Clone Integration (AC: 1, 2)
  - [x] Modify `WorkspaceService.createWorkspace()` in `src/ai-routing/providers/workspace.service.ts` to use `GitMirrorService`
  - [x] **CRITICAL:** Use the ai-routing WorkspaceService, NOT `src/docker/workspace.service.ts`
  - [x] Update workspace clone flow: check mirror first → clone from mirror → fallback to direct clone
  - [x] Ensure workspace permissions remain `0o777` for container compatibility (Story 22-3 pattern)
  - [x] Add feature flag `ENABLE_GIT_MIRRORING` (default: true)
  - [x] Reuse `GitOperationsService.clone()` pattern for workspace clones

- [x] Task 4: Mirror Lifecycle & Cleanup (AC: 5)
  - [x] Implement `cleanupStaleMirrors()` - runs periodically (configurable interval)
  - [x] Implement `evictOldestMirrorsIfNeeded()` - LRU eviction when disk space low
  - [x] Use `StorageManagerService.getDiskUsage()` pattern for disk space checks
  - [x] Add disk space monitoring: check available space before creating new mirror
  - [x] Implement `removeMirror(owner: string, repo: string): Promise<void>` for manual cleanup

- [x] Task 5: Authentication Integration (AC: 4)
  - [x] Format authenticated URL: `https://x-access-token:{token}@github.com/{owner}/{repo}.git`
  - [x] Add proper error handling for auth failures (401/403 responses) via `MirrorAuthError`

- [x] Task 6: Configuration & Environment (AC: 1, 5, 6)
  - [x] Add to `env.validation.ts`:
    - `GIT_MIRROR_BASE_PATH` (default: `/tmp/dsf/git-mirrors`)
    - `GIT_MIRROR_TTL_HOURS` (default: 24)
    - `GIT_MIRROR_MAX_SIZE_GB` (default: 50)
    - `GIT_MIRROR_MIN_FREE_SPACE_GB` (default: 10)
    - `GIT_MIRROR_CLEANUP_INTERVAL_MS` (default: 3600000 = 1 hour)
    - `ENABLE_GIT_MIRRORING` (default: true)
  - [ ] Add Prisma schema for `GitMirror` tracking (optional but recommended):

    ```prisma
    model GitMirror {
      id            String   @id @default(uuid())
      owner         String
      repo          String
      mirrorPath    String   @unique
      sizeBytes     Int
      lastUpdated   DateTime
      lastUsed      DateTime
      cloneCount    Int      @default(0)
      createdAt     DateTime @default(now())

      @@unique([owner, repo])
      @@index([lastUsed])
    }
    ```

- [x] Task 7: Metrics & Observability (AC: 6)
  - [x] Add Prometheus metrics using `@InjectMetric` decorator pattern
  - [x] Metrics to track: `git_mirror_total`, `git_mirror_clone_duration_seconds`, `git_mirror_hit_total` (hit/miss labels), `git_mirror_update_duration_seconds`
  - [x] Add structured logging for all mirror operations
  - [x] Add correlation IDs via executionId in logs

- [x] Task 8: Unit and Integration Tests
  - [x] Test `GitMirrorService.getOrCreateMirror()` with mocked git operations
  - [x] Test mirror staleness detection logic
  - [x] Test LRU eviction algorithm
  - [x] Test auth token integration with mocked `GitHubAuthService`
  - [x] Test `WorkspaceService` integration with mirror fallback
  - [x] Test error handling for network failures, auth failures

## Dev Notes

### Mirror Directory Structure

```
/tmp/dsf/git-mirrors/
├── alpharages/
│   ├── Dark Software Factory.git/          # Bare mirror
│   │   ├── config
│   │   ├── description
│   │   ├── HEAD
│   │   ├── objects/
│   │   ├── refs/
│   │   └── ... (standard bare repo structure)
│   └── another-repo.git/
├── client-org/
│   └── client-project.git/
└── .metadata/
    └── mirrors.json                        # Mirror metadata tracking
```

### Module Dependencies

```typescript
// src/git-mirror/git-mirror.module.ts
@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    GitHubModule, // For GitHubAuthService
    LoggerModule,
    AppMetricsModule, // For metrics
    StorageModule, // For StorageManagerService disk space checks
  ],
  providers: [GitMirrorService, ...metricProviders],
  exports: [GitMirrorService],
})
export class GitMirrorModule {}
```

### Core Service Interface

```typescript
// src/git-mirror/interfaces/mirror-info.interface.ts
export interface MirrorInfo {
  owner: string;
  repo: string;
  mirrorPath: string;
  sizeBytes: number;
  lastUpdated: Date;
  lastUsed: Date;
  cloneCount: number;
}

// src/git-mirror/git-mirror.service.ts
@Injectable()
export class GitMirrorService {
  constructor(
    private readonly githubAuthService: GitHubAuthService,
    private readonly configService: ConfigService,
    private readonly storageManager: StorageManagerService,
    private readonly logger: LoggerService,
    @InjectMetric('git_mirror_total') private readonly mirrorGauge: Gauge<string>,
    @InjectMetric('git_mirror_hit_total') private readonly hitCounter: Counter<string>,
  ) {}

  async getOrCreateMirror(repoUrl: string): Promise<MirrorInfo>;
  async cloneFromMirror(mirrorPath: string, targetPath: string): Promise<void>;
  async updateMirror(repoUrl: string): Promise<void>;
  async isMirrorValid(repoUrl: string): Promise<boolean>;
  async cleanupStaleMirrors(): Promise<number>;
  async evictIfLowDiskSpace(): Promise<number>;
}
```

### Git Commands Used

```bash
# Create bare mirror (initial)
git clone --mirror https://x-access-token:TOKEN@github.com/owner/repo.git /mirrors/owner/repo.git

# Update existing mirror
cd /mirrors/owner/repo.git
git fetch --prune

# Clone from mirror to workspace (fast!)
git clone --reference /mirrors/owner/repo.git \
  https://x-access-token:TOKEN@github.com/owner/repo.git \
  /tmp/dsf/workspaces/{execution-id}/workspace

# Get mirror size
du -sb /mirrors/owner/repo.git
```

### Reuse Existing GitOperationsService

Extend the existing `GitOperationsService` (`src/ai-routing/providers/git-operations.service.ts`) for git commands:

- Use `gitOperationsService.clone()` as reference for implementing mirror operations
- Follow the same `execFile` pattern for security (prevents command injection)
- Use the same timeout (`DEFAULT_TIMEOUT_MS = 120000`) and buffer (`10 * 1024 * 1024`) settings
- See existing methods: `clone()`, `configureUser()`, `checkoutBranch()`

### Authentication Implementation Note

**Current State:** `GitHubAuthService` currently uses `GITHUB_TOKEN` (PAT) from environment.

**Implementation:** Use `this.configService.get('GITHUB_TOKEN')` to get token for authenticated URLs:

```typescript
const token = this.configService.get('GITHUB_TOKEN');
const authUrl = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
```

### Integration with Existing Workspace Flow

```typescript
// Modified WorkspaceService.createWorkspace()
async createWorkspace(executionId: string, repoUrl: string): Promise<WorkspaceInfo> {
  const workspacePath = path.join(this.workspaceBasePath, executionId, 'workspace');

  // Create directory with proper permissions
  await fs.mkdir(workspacePath, { recursive: true, mode: 0o777 });

  // Try mirror-based clone first (if enabled)
  if (this.configService.get('ENABLE_GIT_MIRRORING')) {
    try {
      const mirror = await this.gitMirrorService.getOrCreateMirror(repoUrl);
      await this.gitMirrorService.cloneFromMirror(mirror.mirrorPath, workspacePath);
      this.metricsService.recordMirrorHit();
      return { path: workspacePath, executionId, source: 'mirror' };
    } catch (error) {
      this.logger.warn('Mirror clone failed, falling back to direct clone', { error: error.message });
      this.metricsService.recordMirrorMiss();
    }
  }

  // Fallback: direct clone from GitHub
  await this.cloneFromGitHub(repoUrl, workspacePath);
  return { path: workspacePath, executionId, source: 'direct' };
}
```

### Performance Expectations

| Operation          | Direct Clone | Mirror Clone          | Speedup          |
| ------------------ | ------------ | --------------------- | ---------------- |
| Fresh repo (100MB) | ~30s         | ~30s (initial) + ~2s  | ~15x after first |
| Large repo (1GB)   | ~3min        | ~3min (initial) + ~5s | ~36x after first |
| Update only        | N/A          | ~5-10s                | N/A              |

### LRU Eviction Algorithm

```typescript
private async evictOldestMirrorsIfNeeded(): Promise<number> {
  // Use StorageManagerService for disk space checks
  const freeSpace = await this.storageManager.checkAvailableSpace(this.mirrorBasePath);
  const minFree = this.configService.get('GIT_MIRROR_MIN_FREE_SPACE_GB') * 1024 * 1024 * 1024;

  if (freeSpace > minFree) return 0;

  // Get all mirrors sorted by lastUsed (oldest first)
  const mirrors = await this.getAllMirrorsSortedByLastUsed();
  let evicted = 0;

  for (const mirror of mirrors) {
    if (await this.storageManager.checkAvailableSpace(this.mirrorBasePath) > minFree) break;

    await this.removeMirror(mirror.owner, mirror.repo);
    this.logger.info('Evicted mirror due to low disk space', {
      owner: mirror.owner,
      repo: mirror.repo,
      sizeBytes: mirror.sizeBytes
    });
    evicted++;
  }

  return evicted;
}
```

### Error Handling Strategy

| Error Type             | Handling                                                                   |
| ---------------------- | -------------------------------------------------------------------------- |
| Auth failure (401/403) | Throw `MirrorAuthError`, log with repo context                             |
| Network timeout        | Retry with exponential backoff (3 attempts), then fallback to direct clone |
| Disk full              | Trigger immediate eviction, then retry mirror creation                     |
| Corrupted mirror       | Detect via `git fsck`, remove and recreate                                 |
| Mirror locked          | Wait with timeout, skip to direct clone if timeout exceeded                |

### Error Exception Pattern

Create custom exceptions in `src/git-mirror/exceptions/git-mirror.exception.ts`:

```typescript
export class GitMirrorException extends InfrastructureException {
  constructor(message: string, status: HttpStatus = HttpStatus.INTERNAL_SERVER_ERROR) {
    super(message, status, 'GIT_MIRROR_ERROR');
  }
}

export class MirrorAuthError extends GitMirrorException {
  constructor(repoUrl: string) {
    super(`Authentication failed for mirror: ${repoUrl}`, HttpStatus.UNAUTHORIZED);
  }
}

export class MirrorNetworkError extends GitMirrorException {
  constructor(repoUrl: string, originalError: string) {
    super(`Network error for mirror ${repoUrl}: ${originalError}`, HttpStatus.SERVICE_UNAVAILABLE);
  }
}

export class MirrorCorruptedError extends GitMirrorException {
  constructor(mirrorPath: string) {
    super(`Mirror corrupted at ${mirrorPath}, will recreate`, HttpStatus.INTERNAL_SERVER_ERROR);
  }
}
```

Follow the pattern from `src/github/exceptions/github.exceptions.ts`

### Security Considerations

- **Token Isolation**: Never log the full authenticated URL with token
- **Mirror Permissions**: Set mirror directory permissions to `0o700` (owner only)
- **Workspace Isolation**: Each workspace remains isolated (Story 22-3 pattern)
- **No Cross-Repo Leakage**: Mirrors are per-repo, no shared objects between different repos

### Configuration Reference

| Variable                         | Default                | Description                               |
| -------------------------------- | ---------------------- | ----------------------------------------- |
| `GIT_MIRROR_BASE_PATH`           | `/tmp/dsf/git-mirrors` | Root directory for all mirrors            |
| `GIT_MIRROR_TTL_HOURS`           | `24`                   | Hours before mirror considered stale      |
| `GIT_MIRROR_MAX_SIZE_GB`         | `50`                   | Max total size for all mirrors            |
| `GIT_MIRROR_MIN_FREE_SPACE_GB`   | `10`                   | Min free space before triggering eviction |
| `GIT_MIRROR_CLEANUP_INTERVAL_MS` | `3600000`              | Cleanup job interval (1 hour)             |
| `ENABLE_GIT_MIRRORING`           | `true`                 | Feature flag to disable mirroring         |

### Project Structure Notes

New/modified files:

- `src/git-mirror/git-mirror.module.ts` - NestJS module definition
- `src/git-mirror/git-mirror.service.ts` - Core mirror management service
- `src/git-mirror/git-mirror.service.spec.ts` - Unit tests
- `src/git-mirror/interfaces/mirror-info.interface.ts` - Type definitions
- `src/git-mirror/interfaces/mirror-metadata.interface.ts` - Metadata types
- `src/git-mirror/exceptions/git-mirror.exception.ts` - Custom exceptions
- `src/ai-routing/providers/workspace.service.ts` - **MODIFY** to integrate with GitMirrorService
- `src/config/env.validation.ts` - Add mirror-related config
- `prisma/schema.prisma` - Add `GitMirror` model (as specified in Task 6)

### Dependencies

- Extends `WorkspaceService` in `src/ai-routing/providers/workspace.service.ts` (Story 22-3) - integrates mirror-based cloning
- Reuses `GitHubAuthService` - for authenticated mirror operations
- Reuses `GitOperationsService` - for git command execution patterns
- Reuses `StorageManagerService` - for disk space checks
- Uses `ExecutionTracker` - for correlation IDs in logs
- Uses `AppMetricsModule` - for Prometheus metrics

### Key Architectural Decisions

- **Bare vs. Normal Clone**: Using `--mirror` creates a true bare repo (no working tree, all refs)
- **Reference Clone**: Using `--reference` for workspace clones shares objects, saves disk
- **TTL-based Staleness**: Mirrors are refreshed periodically, not on every use (optimization)
- **Background Cleanup**: Cleanup job runs on interval, not blocking task execution
- **Graceful Degradation**: Any mirror failure falls back to direct clone

### References

- [Source: epics-containerization.md#Story 2.1]
- [Source: sprint-status.yaml#epic-23]
- [Story 22-3: Sandbox Workspace Mounting - WorkspaceService patterns]
- [Architecture: GitHub Auth Service - Token-based authentication]
- [Git Documentation: git-clone --mirror](https://git-scm.com/docs/git-clone#Documentation/git-clone.txt---mirror)
- [Git Documentation: git-clone --reference](https://git-scm.com/docs/git-clone#Documentation/git-clone.txt---reference-if-ableltrepositorygt)

## Dev Agent Record

### Agent Model Used

Claude Code CLI

### Debug Log References

- Tests: `src/git-mirror/git-mirror.service.spec.ts` (12 tests)
- Tests: `src/ai-routing/providers/workspace.service.spec.ts` (17 tests including mirror integration)

### Completion Notes List

1. **Task 1: GitMirrorService Module** - Created complete NestJS module with:
   - `git-mirror.module.ts` - Module definition with Prometheus metric providers
   - `git-mirror.service.ts` - Core service with mirror management logic
   - `git-mirror.exception.ts` - Custom exceptions (MirrorAuthError, MirrorNetworkError, etc.)
   - Interface definitions for MirrorInfo and MirrorMetadata

2. **Task 2: Bare Mirror Management** - Implemented:
   - `createBareMirror()` - Creates bare mirror using `git clone --mirror`
   - `updateBareMirror()` - Updates mirror using `git fetch --prune`
   - `isMirrorStale()` - TTL-based staleness detection
   - Metadata persistence via JSON file in `.metadata/mirrors.json`

3. **Task 3: Workspace Clone Integration** - Modified:
   - `WorkspaceService.createWorkspace()` to use mirror-first approach
   - Mirror clone attempts first, falls back to direct clone on failure
   - Feature flag `ENABLE_GIT_MIRRORING` controls behavior

4. **Task 4: Mirror Lifecycle & Cleanup** - Implemented:
   - `cleanupStaleMirrors()` - Periodic cleanup of mirrors exceeding TTL
   - `evictOldestMirrorsIfNeeded()` - LRU eviction when disk space low
   - Disk space checks before creating new mirrors

5. **Task 5: Authentication Integration** - Uses:
   - `GITHUB_TOKEN` from environment for authenticated URLs
   - Proper error handling for 401/403 responses

6. **Task 6: Configuration** - Added to `env.validation.ts`:
   - GIT_MIRROR_BASE_PATH, GIT_MIRROR_TTL_HOURS, GIT_MIRROR_MAX_SIZE_GB
   - GIT_MIRROR_MIN_FREE_SPACE_GB, GIT_MIRROR_CLEANUP_INTERVAL_MS
   - ENABLE_GIT_MIRRORING

7. **Task 7: Metrics & Observability** - Added Prometheus metrics:
   - `git_mirror_total` - Gauge for total mirrors
   - `git_mirror_hit_total` - Counter with hit/miss labels
   - `git_mirror_clone_duration_seconds` - Histogram for clone duration
   - `git_mirror_update_duration_seconds` - Histogram for update duration

8. **Task 8: Tests** - Created comprehensive tests:
   - Unit tests for GitMirrorService (12 tests → 15 tests after fixes)
   - Updated WorkspaceService tests for mirror integration
   - All tests passing

### Code Review Fixes Applied (2026-02-03)

**Fixed Issues:**

1. **Configuration Key Mismatch** (HIGH)
   - Fixed: Changed `gitMirror.enabled` to `ENABLE_GIT_MIRRORING` in `workspace.service.ts`
   - File: `src/ai-routing/providers/workspace.service.ts:235`

2. **Missing Metric Updates** (MEDIUM)
   - Fixed: Added `git_mirror_size_bytes` gauge updates when creating mirrors
   - Fixed: Added `git_mirror_evicted_total` counter when evicting mirrors
   - Files: `src/git-mirror/git-mirror.service.ts`, `src/git-mirror/git-mirror.module.ts`

3. **GitHubAuthService Integration** (MEDIUM)
   - Fixed: Added GitHubAuthService dependency and imported GitHubModule
   - Updated token retrieval to use `github.token` config key (consistent with GitHubAuthService)
   - Files: `src/git-mirror/git-mirror.service.ts`, `src/git-mirror/git-mirror.module.ts`

4. **Test Updates**
   - Added mocks for new dependencies (GitHubAuthService, sizeGauge, evictedCounter)
   - Added new test cases for size gauge and eviction counter metrics
   - All 32 tests passing

**Remaining Action Items:**

- Task 6 (Prisma schema) - Optional, marked as `[ ]` in original story

### File List

**New Files:**

- `src/git-mirror/git-mirror.module.ts`
- `src/git-mirror/git-mirror.service.ts`
- `src/git-mirror/git-mirror.service.spec.ts`
- `src/git-mirror/index.ts`
- `src/git-mirror/exceptions/git-mirror.exception.ts`
- `src/git-mirror/interfaces/mirror-info.interface.ts`
- `src/git-mirror/interfaces/mirror-metadata.interface.ts`

**Modified Files:**

- `src/ai-routing/providers/workspace.service.ts` - Integrated GitMirrorService
- `src/ai-routing/providers/workspace.service.spec.ts` - Added mirror mock tests
- `src/ai-routing/ai-routing.module.ts` - Added GitMirrorModule import
- `src/app.module.ts` - Added GitMirrorModule to imports
- `src/config/env.validation.ts` - Added git mirror configuration
