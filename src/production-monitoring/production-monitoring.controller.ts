/**
 * Production Monitoring Controller
 * Story 9-U-4: Error Context Extraction & Linking
 *
 * Provides API endpoints for production error monitoring and context retrieval.
 */

import { Controller, Get, Param, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { ErrorContextResponseDto } from './dto/error-context.dto';

@Controller('/api/v1/monitoring')
export class ProductionMonitoringController {
  private readonly logger = new Logger(ProductionMonitoringController.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get error details with full context
   * Includes parsed stack trace, user context, deployment context, and related commits
   */
  @Get('errors/:id')
  async getErrorWithContext(@Param('id') errorId: string): Promise<ErrorContextResponseDto> {
    this.logger.debug(`Fetching error details for ${errorId}`);

    const error = await this.prisma.productionError.findUnique({
      where: { id: errorId },
      include: {
        deployment: {
          include: {
            github_push: {
              select: {
                commit_sha: true,
                branch_name: true,
              },
            },
          },
        },
        related_commits: {
          orderBy: {
            relevance_score: 'desc',
          },
        },
      },
    });

    if (!error) {
      throw new NotFoundException(`Production error ${errorId} not found`);
    }

    // Transform to response DTO
    return {
      id: error.id,
      application: error.application,
      error_type: error.error_type,
      error_message: error.error_message,
      parsed_stack_trace: error.parsed_stack_trace
        ? (error.parsed_stack_trace as unknown as ErrorContextResponseDto['parsed_stack_trace'])
        : undefined,
      user_context: error.user_context
        ? (error.user_context as unknown as ErrorContextResponseDto['user_context'])
        : undefined,
      deployment_context: error.deployment
        ? {
            deployment_id: error.deployment.id,
            commit_sha: error.deployment.github_push?.commit_sha || 'unknown',
            branch: error.deployment.github_push?.branch_name || 'unknown',
            deployed_at: error.deployment.deployed_at || error.deployment.created_at,
          }
        : undefined,
      related_commits: error.related_commits.map((commit) => ({
        sha: commit.commit_sha,
        message: commit.commit_message,
        author: commit.author,
        committed_at: commit.committed_at,
        github_url: commit.github_url,
      })),
      affected_users: error.affected_users,
      occurrence_count: error.occurrence_count,
    };
  }

  /**
   * List all production errors with basic info
   */
  @Get('errors')
  async listErrors(): Promise<
    Array<{
      id: string;
      application: string;
      error_type: string;
      error_message: string;
      severity: string;
      occurred_at: Date;
      affected_users: number;
      occurrence_count: number;
    }>
  > {
    const errors = await this.prisma.productionError.findMany({
      orderBy: {
        occurred_at: 'desc',
      },
      take: 100,
      select: {
        id: true,
        application: true,
        error_type: true,
        error_message: true,
        severity: true,
        occurred_at: true,
        affected_users: true,
        occurrence_count: true,
      },
    });

    return errors;
  }
}
