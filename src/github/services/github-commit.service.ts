import { Injectable, Inject } from '@nestjs/common';
import { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { SentryService } from '../../common/sentry/sentry.service';
import { MetricsService } from '../../common/metrics/metrics.service';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { GitHubClientService } from '../github-client.service';
import { RabbitMQPublisherService } from '../../rabbitmq/rabbitmq-publisher.service';
import { CommitOptions, GitAuthor } from '../interfaces/commit-options.interface';
import { FileChange, CodeOutput } from '../interfaces/file-change.interface';
import { CommitMessageDto } from '../dto/commit-message.dto';
import { CommitResultDto } from '../dto/commit-result.dto';
import { generateConventionalCommit } from '../utils/commit-message.util';
import {
  encodeToBase64,
  buildTreeEntries,
  getFileType,
  calculateTotalSize,
  validateAllFilePaths,
  validateAllFileSizes,
} from '../utils/file-tree.util';
import {
  CommitCreationException,
  PushFailedException,
  FileValidationException,
} from '../exceptions/commit.exceptions';
import {
  GitHubAuthError,
  GitHubRateLimitError,
  GitHubNetworkError,
} from '../exceptions/github.exceptions';
import { GitHubStatus, ExecutionStatus, Prisma } from '@prisma/client';
import { Octokit } from '@octokit/rest';

/**
 * GitHub Commit Service
 *
 * Handles AI-generated code commit and push to GitHub
 * Implements AC#1-6 from Story 4.3
 */
@Injectable()
export class GitHubCommitService {
  constructor(
    private readonly clientService: GitHubClientService,
    private readonly prisma: PrismaService,
    private readonly sentry: SentryService,
    private readonly metrics: MetricsService,
    private readonly audit: AuditLogService,
    private readonly publisher: RabbitMQPublisherService,
    private readonly config: ConfigService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  /**
   * Creates commit and pushes to GitHub
   * Main entry point - orchestrates entire workflow
   *
   * AC#1: Code collection
   * AC#2: Commit message generation
   * AC#3: GitHub commit creation
   * AC#4: Database updates
   * AC#5: Error handling
   * AC#6: Metrics
   */
  async createAndPushCommit(options: CommitOptions): Promise<CommitResultDto> {
    const startTime = Date.now();
    const { executionId, branchName, repository, correlationId, installationId } = options;

    try {
      this.logger.info('Starting commit and push workflow', {
        executionId,
        branchName,
        repository,
        correlationId,
      });

      // AC#1: Load execution and parse code output
      const execution = await this.loadExecution(executionId);
      const fileChanges = this.parseCodeOutput(execution.code_output as string);

      // Validate security and size constraints
      await this.validateFiles(fileChanges);

      // AC#2: Generate commit message
      const commitMessage = this.generateCommitMessage(execution, fileChanges);

      // AC#3: Create commit via GitHub API
      const [owner, repo] = repository.split('/');
      const commitSha = await this.createCommitOnGitHub(
        owner,
        repo,
        branchName,
        fileChanges,
        commitMessage,
        installationId,
      );

      // AC#4: Update database
      await this.updateDatabase(executionId, commitSha);

      // AC#6: Record success metrics
      const duration = Date.now() - startTime;
      this.recordSuccessMetrics(repository, execution, fileChanges, duration);

      this.logger.info('Commit created and pushed successfully', {
        executionId,
        commitSha,
        branchName,
        filesCount: fileChanges.length,
        correlationId,
      });

      return {
        success: true,
        commitSha,
        branchName,
        repository,
        filesCount: fileChanges.length,
        totalSizeBytes: calculateTotalSize(fileChanges),
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      await this.handleCommitError(error as Error, executionId, repository, options, duration);
      throw error;
    }
  }

  /**
   * AC#1: Loads execution with ticket relation
   */
  private async loadExecution(executionId: string) {
    const execution = await this.prisma.execution.findUnique({
      where: { id: executionId },
      include: { ticket: true },
    });

    if (!execution) {
      throw new CommitCreationException(`Execution ${executionId} not found`);
    }

    if (!execution.code_output) {
      throw new CommitCreationException(`Execution ${executionId} has no code output`);
    }

    return execution;
  }

  /**
   * AC#1: Parses code_output JSON to extract files
   */
  private parseCodeOutput(codeOutputJson: string): FileChange[] {
    try {
      const codeOutput: CodeOutput = JSON.parse(codeOutputJson);

      if (!codeOutput.files_changed || !Array.isArray(codeOutput.files_changed)) {
        throw new Error('Invalid code output format: files_changed is missing or not an array');
      }

      return codeOutput.files_changed;
    } catch (error) {
      throw new CommitCreationException(`Failed to parse code output: ${(error as Error).message}`);
    }
  }

  /**
   * AC#1: Validates all files for security and size
   */
  private async validateFiles(files: FileChange[]): Promise<void> {
    // Scan file content for secrets (AC#1 critical requirement)
    for (const file of files) {
      if (file.operation !== 'delete') {
        const secretsFound = this.detectSecrets(file.content);
        if (secretsFound.length > 0) {
          this.logger.error('Secrets detected in commit content', {
            file: file.path,
            secretsCount: secretsFound.length,
            patterns: secretsFound,
          });
          throw new FileValidationException(
            `Secrets detected in ${file.path} - commit blocked for security`,
          );
        }
      }
    }

    // Validate file paths (security: prevent path traversal)
    const pathValidation = validateAllFilePaths(files);
    if (!pathValidation.valid) {
      throw new FileValidationException(
        `Path validation failed: ${pathValidation.errors.join(', ')}`,
      );
    }

    // Validate file sizes (GitHub 100 MB limit) - warn but don't fail
    const sizeValidation = validateAllFileSizes(files);
    if (!sizeValidation.valid) {
      this.logger.warn('File size validation failed - skipping large files', {
        errors: sizeValidation.errors,
      });
      // H4: Don't throw - skip large files instead
      const maxSize = 100 * 1024 * 1024; // 100 MB
      for (let i = files.length - 1; i >= 0; i--) {
        const file = files[i];
        const size = Buffer.from(
          file.content,
          file.encoding === 'base64' ? 'base64' : 'utf-8',
        ).length;
        if (size > maxSize) {
          this.logger.warn(`Skipping oversized file: ${file.path} (${size} bytes)`);
          files.splice(i, 1);
        }
      }
    }
  }

  /**
   * Detects secrets in content using pattern matching
   * Returns array of detected secret types
   */
  private detectSecrets(content: string): string[] {
    const secretPatterns = [
      { name: 'AWS Access Key', regex: /AKIA[0-9A-Z]{16}/ },
      { name: 'GitHub Token', regex: /gh[pousr]_[A-Za-z0-9]{36,}/ },
      {
        name: 'Generic API Key',
        regex: /[aA][pP][iI][_-]?[kK][eE][yY]['"]?\s*[:=]\s*['"]?[A-Za-z0-9]{20,}/,
      },
      { name: 'Private Key', regex: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/ },
      { name: 'JWT Token', regex: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
    ];

    const found: string[] = [];
    for (const pattern of secretPatterns) {
      if (pattern.regex.test(content)) {
        found.push(pattern.name);
      }
    }
    return found;
  }

  /**
   * AC#2: Generates conventional commit message from ticket context
   */
  private generateCommitMessage(
    execution: Prisma.ExecutionGetPayload<{ include: { ticket: true } }>,
    fileChanges: FileChange[],
  ): CommitMessageDto {
    const filePaths = fileChanges.map((f) => f.path);

    return generateConventionalCommit({
      ticketTitle: execution.ticket.title,
      ticketDescription: execution.ticket.description,
      ticketId: execution.ticket.clickup_task_id,
      filePaths,
      executionId: execution.id,
      aiProvider: execution.ai_provider,
      complexityScore: execution.complexity_score || 50,
    });
  }

  /**
   * AC#3: Creates commit on GitHub via API
   * Implements 5-step workflow: Get tree SHA → Create blobs → Create tree → Create commit → Update ref
   */
  private async createCommitOnGitHub(
    owner: string,
    repo: string,
    branchName: string,
    fileChanges: FileChange[],
    commitMessage: CommitMessageDto,
    installationId?: string,
  ): Promise<string> {
    return this.clientService.execute(
      async (client: Octokit) => {
        // Step 1: Get base tree SHA
        const baseTreeSha = await this.getBaseTreeSha(client, owner, repo, branchName);

        // Step 2: Create blobs for each file
        const blobShas = await this.createBlobs(client, owner, repo, fileChanges);

        // Step 3: Create tree
        const treeSha = await this.createTree(
          client,
          owner,
          repo,
          baseTreeSha,
          fileChanges,
          blobShas,
        );

        // Step 4: Create commit
        const parentCommitSha = await this.getLatestCommitSha(client, owner, repo, branchName);
        const commitSha = await this.createCommit(
          client,
          owner,
          repo,
          commitMessage.toString(),
          treeSha,
          parentCommitSha,
        );

        // Step 5: Update branch reference
        await this.updateBranchRef(client, owner, repo, branchName, commitSha);

        return commitSha;
      },
      installationId,
      'createCommit',
    );
  }

  /**
   * Step 1: Get base tree SHA from branch
   */
  private async getBaseTreeSha(
    client: Octokit,
    owner: string,
    repo: string,
    branch: string,
  ): Promise<string> {
    const startTime = Date.now();

    try {
      const { data: refData } = await client.git.getRef({
        owner,
        repo,
        ref: `heads/${branch}`,
      });
      const commitSha = refData.object.sha;

      const { data: commitData } = await client.git.getCommit({
        owner,
        repo,
        commit_sha: commitSha,
      });

      this.metrics.recordGitHubOperationDuration('get_tree_sha', Date.now() - startTime);

      return commitData.tree.sha;
    } catch (error) {
      throw new CommitCreationException(
        `Failed to get base tree SHA: ${(error as Error).message}`,
        error as Error,
      );
    }
  }

  /**
   * Step 2: Create blob for each file (H6: Parallel creation)
   */
  private async createBlobs(
    client: Octokit,
    owner: string,
    repo: string,
    files: FileChange[],
  ): Promise<Map<string, string>> {
    const startTime = Date.now();
    const blobShas = new Map<string, string>();

    try {
      // H6: Create blobs in parallel using Promise.all()
      const blobPromises = files
        .filter((file) => file.operation !== 'delete')
        .map(async (file) => {
          // Encode content to base64
          const encodedContent = encodeToBase64(file.content, file.encoding);

          const { data } = await client.git.createBlob({
            owner,
            repo,
            content: encodedContent,
            encoding: 'base64',
          });

          // Record file type metric
          const fileType = getFileType(file.path);
          this.metrics.incrementGitHubFilesPushed(fileType);

          return { path: file.path, sha: data.sha };
        });

      // Wait for all blobs to be created in parallel
      const blobResults = await Promise.all(blobPromises);

      // Build map from results
      for (const result of blobResults) {
        blobShas.set(result.path, result.sha);
      }

      this.metrics.recordGitHubOperationDuration('create_blobs', Date.now() - startTime);

      return blobShas;
    } catch (error) {
      throw new CommitCreationException(
        `Failed to create blobs: ${(error as Error).message}`,
        error as Error,
      );
    }
  }

  /**
   * Step 3: Create tree with all blobs
   */
  private async createTree(
    client: Octokit,
    owner: string,
    repo: string,
    baseTreeSha: string,
    files: FileChange[],
    blobShas: Map<string, string>,
  ): Promise<string> {
    const startTime = Date.now();

    try {
      const treeEntries = buildTreeEntries(files, blobShas);

      const { data } = await client.git.createTree({
        owner,
        repo,
        base_tree: baseTreeSha,
        tree: treeEntries as any,
      });

      this.metrics.recordGitHubOperationDuration('create_tree', Date.now() - startTime);

      return data.sha;
    } catch (error) {
      throw new CommitCreationException(
        `Failed to create tree: ${(error as Error).message}`,
        error as Error,
      );
    }
  }

  /**
   * Gets latest commit SHA from branch
   */
  private async getLatestCommitSha(
    client: Octokit,
    owner: string,
    repo: string,
    branch: string,
  ): Promise<string> {
    const { data } = await client.git.getRef({
      owner,
      repo,
      ref: `heads/${branch}`,
    });
    return data.object.sha;
  }

  /**
   * Step 4: Create commit
   */
  private async createCommit(
    client: Octokit,
    owner: string,
    repo: string,
    message: string,
    treeSha: string,
    parentSha: string,
  ): Promise<string> {
    const startTime = Date.now();

    try {
      const author = this.getBotIdentity();

      const { data } = await client.git.createCommit({
        owner,
        repo,
        message,
        tree: treeSha,
        parents: [parentSha],
        author: {
          name: author.name,
          email: author.email,
          date: author.date || new Date().toISOString(),
        },
        committer: {
          name: author.name,
          email: author.email,
          date: author.date || new Date().toISOString(),
        },
      });

      this.metrics.recordGitHubOperationDuration('create_commit', Date.now() - startTime);

      return data.sha;
    } catch (error) {
      throw new CommitCreationException(
        `Failed to create commit: ${(error as Error).message}`,
        error as Error,
      );
    }
  }

  /**
   * Step 5: Update branch reference to point to new commit
   */
  private async updateBranchRef(
    client: Octokit,
    owner: string,
    repo: string,
    branch: string,
    commitSha: string,
  ): Promise<void> {
    const startTime = Date.now();

    try {
      await client.git.updateRef({
        owner,
        repo,
        ref: `heads/${branch}`,
        sha: commitSha,
        force: false,
      });

      this.metrics.recordGitHubOperationDuration('update_ref', Date.now() - startTime);
    } catch (error) {
      throw new PushFailedException(
        `Failed to update branch reference: ${(error as Error).message}`,
        error as Error,
      );
    }
  }

  /**
   * AC#4: Updates database records after successful push
   */
  private async updateDatabase(executionId: string, commitSha: string): Promise<void> {
    try {
      // Update github_pushes record
      await this.prisma.gitHubPush.updateMany({
        where: { execution_id: executionId },
        data: {
          commit_sha: commitSha,
          push_status: GitHubStatus.COMMITTED,
          updated_at: new Date(),
        },
      });

      // Create audit log
      await this.audit.log({
        action: 'github_commit_push',
        entityType: 'execution',
        entityId: executionId,
        actorType: 'system',
        afterState: {
          commitSha,
          status: 'PUSHED',
        },
      });
    } catch (error) {
      this.logger.error('Failed to update database', {
        executionId,
        commitSha,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * AC#6: Records success metrics
   */
  private recordSuccessMetrics(
    repository: string,
    execution: Prisma.ExecutionGetPayload<{ include: { ticket: true } }>,
    fileChanges: FileChange[],
    duration: number,
  ): void {
    const totalSize = calculateTotalSize(fileChanges);

    this.metrics.incrementGitHubCommitsCreated('success', repository, execution.ai_provider);
    this.metrics.recordGitHubCommitDuration(duration);
    this.metrics.recordGitHubCommitSize(totalSize, repository);
    this.metrics.incrementGitHubPushSuccess(repository);
  }

  /**
   * AC#5: Comprehensive error handling
   */
  private async handleCommitError(
    error: Error,
    executionId: string,
    repository: string,
    options: CommitOptions,
    _duration: number,
  ): Promise<void> {
    const { correlationId } = options;

    this.logger.error('Commit and push failed', {
      executionId,
      repository,
      error: error.message,
      correlationId,
    });

    // Record failure metrics
    this.metrics.incrementGitHubCommitsCreated('failed', repository, 'unknown');

    if (error instanceof GitHubAuthError) {
      // Non-retryable: Auth failure
      this.sentry.captureException(error, {
        extra: {
          executionId,
          repository,
          operation: 'commit_push',
          correlationId,
        },
      });

      await this.updateGitHubPushStatus(executionId, 'AUTH_FAILED', error.message);
      await this.updateExecutionStatus(executionId, 'FAILED');
    } else if (error instanceof GitHubRateLimitError) {
      // Retryable: Rate limit exceeded
      await this.handleRateLimitError(error, executionId, options);
    } else if (error instanceof GitHubNetworkError) {
      // Retryable: Network error
      await this.handleNetworkError(error, executionId, options);
    } else {
      // Unknown error
      this.sentry.captureException(error, {
        extra: {
          executionId,
          repository,
          operation: 'commit_push',
          correlationId,
        },
      });

      await this.updateGitHubPushStatus(executionId, 'FAILED', error.message.substring(0, 500));
    }
  }

  /**
   * Handles rate limit errors with delayed retry
   */
  private async handleRateLimitError(
    error: GitHubRateLimitError,
    executionId: string,
    options: CommitOptions,
  ): Promise<void> {
    const delayMs = error.resetTime ? error.resetTime.getTime() - Date.now() : 60000;

    this.logger.warn('GitHub rate limit exceeded, scheduling retry', {
      executionId,
      delayMs,
      resetTime: error.resetTime,
    });

    this.metrics.incrementGitHubRateLimitHit();

    await this.publisher.publishToQueue(
      'github-retry-queue',
      {
        executionId,
        operation: 'commit_push',
        repository: options.repository,
        branchName: options.branchName,
        retryCount: 0,
      },
      options.correlationId,
      delayMs,
    );
  }

  /**
   * Handles network errors with exponential backoff
   */
  private async handleNetworkError(
    error: GitHubNetworkError,
    executionId: string,
    options: CommitOptions,
  ): Promise<void> {
    this.logger.warn('GitHub network error, scheduling retry', {
      executionId,
      error: error.message,
    });

    await this.publisher.publishToQueue(
      'github-retry-queue',
      {
        executionId,
        operation: 'commit_push',
        repository: options.repository,
        branchName: options.branchName,
        retryCount: 0,
      },
      options.correlationId,
      2000, // 2 seconds for first retry
    );
  }

  /**
   * Updates github_pushes status
   */
  private async updateGitHubPushStatus(
    executionId: string,
    status: string,
    errorMessage?: string,
  ): Promise<void> {
    await this.prisma.gitHubPush.updateMany({
      where: { execution_id: executionId },
      data: {
        push_status: status as GitHubStatus,
        error_message: errorMessage,
        updated_at: new Date(),
      },
    });
  }

  /**
   * Updates execution status on fatal errors
   */
  private async updateExecutionStatus(executionId: string, status: string): Promise<void> {
    await this.prisma.execution.update({
      where: { id: executionId },
      data: { status: status as ExecutionStatus },
    });
  }

  /**
   * Gets bot identity from configuration
   */
  private getBotIdentity(): GitAuthor {
    return {
      name: this.config.get('GITHUB_BOT_NAME') || 'AI Dev Bot',
      email: this.config.get('GITHUB_BOT_EMAIL') || 'bot@darkfactory.ai',
    };
  }
}
