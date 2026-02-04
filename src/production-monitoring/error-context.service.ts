/**
 * Error Context Service
 * Story 9-U-4: Error Context Extraction & Linking
 *
 * Extracts and links contextual information to production errors:
 * - Stack traces with file/line parsing
 * - User context (ID, session, IP hash, user agent)
 * - Deployment context (commit SHA, branch, deployer)
 * - Related code commits from git history
 */

import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@/prisma/client';
import { PrismaService } from '@/database/prisma.service';
import { SystemConfigService } from '@/system-settings/system-config.service';
import { SentryService } from '@/common/sentry/sentry.service';
import { ProductionErrorModel as ProductionError } from '@/prisma/models';
import { ParsedStackTrace, StackTraceFrame, ErrorContext, CommitInfo } from './interfaces';

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/** Default timeout for git operations (5 seconds) */
const GIT_TIMEOUT_MS = 5000;

/** Regex pattern to parse stack trace frames */
// Matches: at functionName (file:line:col) OR at async functionName (file:line:col) OR at file:line:col
const STACK_FRAME_REGEX =
  /at\s+(?:async\s+)?(?:([^\s(]+(?:\s*\.\s*[^\s(]+)*)\s+\()?([^:)\s]+):(\d+):(\d+)\)?/;

@Injectable()
export class ErrorContextService {
  private readonly logger = new Logger(ErrorContextService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    private readonly sentry: SentryService,
  ) {}

  /**
   * Main entry point: Extract and link all context for a production error
   */
  async extractAndLinkContext(
    errorId: string,
    correlationId?: string,
  ): Promise<ErrorContext | null> {
    const logContext = { errorId, correlationId };
    this.logger.log(`[${correlationId}] Extracting context for error ${errorId}`, logContext);

    try {
      // Load error from database
      const error = await this.prisma.productionError.findUnique({
        where: { id: errorId },
        include: { deployment: true },
      });

      if (!error) {
        this.logger.error(`[${correlationId}] Error ${errorId} not found`, logContext);
        return null;
      }

      // Check if context extraction is enabled
      const enabled = await this.isContextExtractionEnabled();
      if (!enabled) {
        this.logger.log(`[${correlationId}] Context extraction is disabled`, logContext);
        return null;
      }

      // Parse stack trace
      const parsedStackTrace = error.stack_trace
        ? this.parseStackTrace(error.stack_trace)
        : undefined;

      // Extract user context from metadata (if available in error)
      const userContext = this.extractUserContext(error);

      // Find related deployment
      const deployment = await this.findRelatedDeployment(error);

      // Find related commits using parsed stack trace file paths
      const filePaths = parsedStackTrace?.frames.map((f) => f.file) || [];
      const commits = await this.findRelatedCommits(error, filePaths, correlationId);

      // Update error record with extracted context
      await this.updateErrorRecord(errorId, parsedStackTrace, userContext, deployment?.id);

      // Create commit records
      if (commits.length > 0) {
        await this.createCommitRecords(errorId, commits);
      }

      // Log to audit
      await this.logDecision(
        errorId,
        deployment?.id || null,
        commits.length,
        `Context extracted: ${filePaths.length} files, ${commits.length} commits`,
        correlationId,
      );

      this.logger.log(
        `[${correlationId}] Context extraction complete for error ${errorId}: ${commits.length} commits linked`,
        logContext,
      );

      return {
        id: error.id,
        application: error.application,
        error_type: error.error_type,
        error_message: error.error_message,
        parsed_stack_trace: parsedStackTrace,
        user_context: userContext,
        deployment_context: deployment
          ? {
              deployment_id: deployment.id,
              commit_sha: deployment.github_push?.commit_sha || 'unknown',
              branch: deployment.github_push?.branch_name || 'unknown',
              deployed_at: deployment.deployed_at || deployment.created_at,
            }
          : undefined,
        related_commits: commits,
        affected_users: error.affected_users,
        occurrence_count: error.occurrence_count,
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[${correlationId}] Failed to extract context for error ${errorId}: ${errorMsg}`,
        err,
      );
      this.sentry.captureException(err instanceof Error ? err : new Error(errorMsg), {
        extra: { errorId, correlationId },
      });
      throw err;
    }
  }

  /**
   * Parse stack trace string into structured format
   */
  parseStackTrace(stackTrace: string): ParsedStackTrace {
    const lines = stackTrace.split('\n').map((line) => line.trim());
    const frames: StackTraceFrame[] = [];

    for (const line of lines) {
      const match = STACK_FRAME_REGEX.exec(line);
      if (match) {
        const [, funcName, filePath, lineNum, colNum] = match;
        frames.push({
          file: filePath || 'unknown',
          line: parseInt(lineNum, 10) || 0,
          column: colNum ? parseInt(colNum, 10) : undefined,
          function: funcName || 'anonymous',
        });
      }
    }

    // Top frame is the most likely source of error (first in array for JS stack traces)
    // Entry frame is where execution started (last in array)
    const topFrame = frames[0] || { file: 'unknown', line: 0, function: 'unknown' };
    const entryFrame = frames[frames.length - 1] || topFrame;

    return {
      frames,
      top_frame: topFrame,
      entry_frame: entryFrame,
      raw: stackTrace,
    };
  }

  /**
   * Find related deployment based on application and time window
   */
  async findRelatedDeployment(error: ProductionError): Promise<{
    id: string;
    github_push_id: string;
    environment: string;
    cicd_provider: string;
    build_id: string | null;
    status: string;
    deployed_at: Date | null;
    created_at: Date;
    updated_at: Date;
    error_message: string | null;
    workflow_id: string | null;
    github_push?: { commit_sha: string | null; branch_name: string } | null;
  } | null> {
    const windowMinutes = await this.getDeploymentLookupWindow();
    const windowMs = windowMinutes * 60 * 1000;

    // Find deployments within time window
    const deployment = await this.prisma.deployment.findFirst({
      where: {
        github_push: {
          repository: {
            contains: error.application,
            mode: 'insensitive',
          },
        },
        created_at: {
          gte: new Date(error.occurred_at.getTime() - windowMs),
          lte: new Date(error.occurred_at.getTime() + windowMs),
        },
      },
      include: {
        github_push: {
          select: {
            commit_sha: true,
            branch_name: true,
          },
        },
      },
      orderBy: {
        created_at: 'desc',
      },
    });

    return deployment;
  }

  /**
   * Find related commits by querying git history for affected files
   */
  async findRelatedCommits(
    error: ProductionError,
    filePaths: string[],
    correlationId?: string,
  ): Promise<CommitInfo[]> {
    if (filePaths.length === 0) {
      return [];
    }

    const historyDays = await this.getCommitHistoryDays();
    const since = new Date();
    since.setDate(since.getDate() - historyDays);

    // Get repository URL for GitHub links
    const githubUrl = await this.resolveGitHubRepoUrl(error.application);

    try {
      // Query git log for each file path
      const commits: Map<string, CommitInfo & { relevance_score: number; files: string[] }> =
        new Map();

      for (const filePath of filePaths) {
        // Skip node_modules and internal files
        if (filePath.includes('node_modules') || !filePath.includes('src')) {
          continue;
        }

        const fileCommits = await this.queryGitLog(filePath, since, githubUrl);

        for (const commit of fileCommits) {
          const existing = commits.get(commit.sha);
          if (existing) {
            // Update relevance score for multiple file matches
            existing.relevance_score = Math.min(1, existing.relevance_score + 0.2);
            existing.files.push(filePath);
          } else {
            commits.set(commit.sha, {
              ...commit,
              relevance_score: this.calculateRelevanceScore(commit, error),
              files: [filePath],
            });
          }
        }
      }

      // Sort by relevance score (highest first) and return top 10
      const sortedCommits = Array.from(commits.values())
        .sort((a, b) => b.relevance_score - a.relevance_score)
        .slice(0, 10);

      // Remove internal tracking fields before returning
      return sortedCommits.map(
        ({ relevance_score: _relevance_score, files: _files, ...commit }) => commit,
      );
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[${correlationId}] Failed to query git history: ${errorMsg}`);
      return [];
    }
  }

  /**
   * Extract user context from error metadata
   * Note: In production, this would come from error metadata passed during ingestion
   */
  private extractUserContext(
    error: ProductionError,
  ): { user_id?: string; session_id?: string; ip_hash?: string; user_agent?: string } | undefined {
    // If user_context is already stored (from previous extraction), return it
    if (error.user_context && typeof error.user_context === 'object') {
      return error.user_context as {
        user_id?: string;
        session_id?: string;
        ip_hash?: string;
        user_agent?: string;
      };
    }

    // Otherwise, return undefined - user context would need to be provided during error ingestion
    return undefined;
  }

  /**
   * Query git log for a specific file
   */
  private async queryGitLog(
    filePath: string,
    since: Date,
    githubUrl: string | null,
  ): Promise<(CommitInfo & { relevance_score: number })[]> {
    try {
      // Format: hash|author|date|subject
      const format = '%H|%an|%aI|%s';

      const result = await execFileAsync(
        'git',
        ['log', `--since=${since.toISOString()}`, `--format=${format}`, '--', filePath],
        {
          timeout: GIT_TIMEOUT_MS,
          maxBuffer: 10 * 1024 * 1024, // 10MB buffer
        },
      );

      const lines = result.stdout.split('\n').filter((line) => line.trim());
      const commits: (CommitInfo & { relevance_score: number })[] = [];

      for (const line of lines) {
        const [sha, author, dateStr, ...messageParts] = line.split('|');
        if (sha && author && dateStr) {
          const message = messageParts.join('|');
          commits.push({
            sha: sha.substring(0, 7), // Short SHA
            message,
            author,
            committed_at: new Date(dateStr),
            github_url: githubUrl ? `${githubUrl}/commit/${sha}` : '',
            relevance_score: 0.5, // Base score, will be adjusted
          });
        }
      }

      return commits;
    } catch {
      // Git command failed (file not tracked, etc.)
      return [];
    }
  }

  /**
   * Calculate relevance score for a commit based on various factors
   */
  private calculateRelevanceScore(
    commit: { committed_at: Date; message: string },
    error: ProductionError,
  ): number {
    let score = 0.5;

    // Recency factor: commits closer to error time are more relevant
    const hoursDiff = Math.abs(
      (commit.committed_at.getTime() - error.occurred_at.getTime()) / (1000 * 60 * 60),
    );
    if (hoursDiff < 1) {
      score += 0.3;
    } else if (hoursDiff < 6) {
      score += 0.2;
    } else if (hoursDiff < 24) {
      score += 0.1;
    }

    // Message keywords that indicate fix attempts
    const fixKeywords = ['fix', 'bug', 'error', 'crash', 'patch', 'hotfix', 'resolve'];
    const messageLower = commit.message.toLowerCase();
    for (const keyword of fixKeywords) {
      if (messageLower.includes(keyword)) {
        score += 0.1;
        break;
      }
    }

    return Math.min(1, score);
  }

  /**
   * Resolve GitHub repository URL from project or config
   */
  private async resolveGitHubRepoUrl(application: string): Promise<string | null> {
    try {
      // 1. Find project by application name
      const project = await this.prisma.project.findFirst({
        where: {
          name: { equals: application, mode: 'insensitive' },
        },
        select: { github_repository_url: true },
      });

      if (project?.github_repository_url) {
        // Remove trailing .git if present
        return project.github_repository_url.replace(/\.git$/, '');
      }

      // 2. Fallback: Check SystemConfig for default
      const defaultRepo = await this.config.get('DEFAULT_GITHUB_REPOSITORY_URL');
      return defaultRepo ? defaultRepo.replace(/\.git$/, '') : null;
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Failed to resolve GitHub repo URL: ${errorMsg}`);
      return null;
    }
  }

  /**
   * Update error record with extracted context
   */
  private async updateErrorRecord(
    errorId: string,
    parsedStackTrace?: ParsedStackTrace,
    userContext?: { user_id?: string; session_id?: string; ip_hash?: string; user_agent?: string },
    deploymentId?: string,
  ): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = {
      deployment_id: deploymentId,
    };

    if (parsedStackTrace) {
      data.parsed_stack_trace = parsedStackTrace as unknown as Prisma.InputJsonValue;
    }

    if (userContext) {
      data.user_context = userContext as unknown as Prisma.InputJsonValue;
    }

    await this.prisma.productionError.update({
      where: { id: errorId },
      data,
    });
  }

  /**
   * Create ProductionErrorCommit records
   */
  private async createCommitRecords(errorId: string, commits: CommitInfo[]): Promise<void> {
    for (const commit of commits) {
      // Calculate relevance score (simplified)
      const relevanceScore = 0.7; // Default score

      await this.prisma.productionErrorCommit.create({
        data: {
          production_error_id: errorId,
          commit_sha: commit.sha,
          commit_message: commit.message,
          author: commit.author,
          committed_at: commit.committed_at,
          file_path: '', // Will be filled if needed from the files array
          relevance_score: relevanceScore,
          github_url: commit.github_url,
        },
      });
    }
  }

  /**
   * Check if context extraction is enabled
   */
  private async isContextExtractionEnabled(): Promise<boolean> {
    const value = await this.config.get('CONTEXT_EXTRACTION_ENABLED', 'true');
    return value.toLowerCase() === 'true';
  }

  /**
   * Get deployment lookup window in minutes
   */
  private async getDeploymentLookupWindow(): Promise<number> {
    const value = await this.config.get('DEPLOYMENT_LOOKUP_WINDOW_MINUTES', '60');
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? 60 : parsed;
  }

  /**
   * Get commit history lookup days
   */
  private async getCommitHistoryDays(): Promise<number> {
    const value = await this.config.get('COMMIT_HISTORY_DAYS', '7');
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? 7 : parsed;
  }

  /**
   * Log decision to AI decision logs
   */
  private async logDecision(
    errorId: string,
    deploymentId: string | null,
    commitsFound: number,
    reasoning: string,
    correlationId?: string,
  ): Promise<void> {
    try {
      await this.prisma.aIDecisionLog.create({
        data: {
          agent_name: 'ErrorContextService',
          action: 'ERROR_CONTEXT_EXTRACTED',
          reasoning,
          ticket_id: errorId,
          execution_id: correlationId || null,
          confidence: 0.9,
          input_data: {
            error_id: errorId,
            correlation_id: correlationId,
          },
          output_data: {
            deployment_id: deploymentId,
            commits_found: commitsFound,
          },
        },
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to log decision: ${errorMsg}`);
    }
  }
}
