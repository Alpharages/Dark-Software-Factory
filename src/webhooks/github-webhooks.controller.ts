import {
  Controller,
  Post,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '@/common/decorators';
import { CorrelationId } from '@/common/decorators/correlation-id.decorator';
import { PrismaService } from '@/database/prisma.service';
import { GitHubWebhookSignatureGuard } from './guards';
import { FileLockManagerService } from '@/file-locks/file-lock-manager.service';

/**
 * GitHub Webhook Controller (minimal)
 *
 * Handles PR merge events and triggers automatic file lock release (Story 12.3 AC#4).
 */
@ApiTags('webhooks')
@Controller('api/v1/webhooks')
export class GitHubWebhooksController {
  private readonly logger = new Logger(GitHubWebhooksController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fileLocks: FileLockManagerService,
  ) {}

  @Public()
  @UseGuards(GitHubWebhookSignatureGuard)
  @Post('github')
  @HttpCode(HttpStatus.OK)
  async handleGitHubWebhook(
    @Headers('x-github-event') event: string,
    @Body() payload: any,
    @CorrelationId() correlationId: string,
  ): Promise<{ success: boolean }> {
    try {
      if (event !== 'pull_request') {
        return { success: true };
      }

      const action = payload?.action;
      const merged = payload?.pull_request?.merged === true;

      if (action !== 'closed' || !merged) {
        return { success: true };
      }

      const repoFullName = payload?.repository?.full_name as string | undefined;
      const prNumber = payload?.pull_request?.number as number | undefined;

      if (!repoFullName || typeof prNumber !== 'number') {
        this.logger.warn(`[${correlationId}] GitHub webhook missing repo/pr info`);
        return { success: true };
      }

      // Code Review Fix #14: Use ordered query to get most recent execution for this PR
      const push = await this.prisma.gitHubPush.findFirst({
        where: {
          repository: repoFullName,
          pr_number: prNumber,
        },
        orderBy: { created_at: 'desc' },
        select: { execution_id: true },
      });

      if (!push?.execution_id) {
        this.logger.log(
          `[${correlationId}] No execution found for merged PR ${repoFullName}#${prNumber} (noop)`,
        );
        return { success: true };
      }

      await this.fileLocks.releaseLocksForExecution(push.execution_id);

      this.logger.log(
        `[${correlationId}] Released file locks for merged PR ${repoFullName}#${prNumber} (execution=${push.execution_id})`,
      );

      return { success: true };
    } catch (error) {
      // Best-effort: do not force GitHub retries for internal failures
      this.logger.error(
        `[${correlationId}] GitHub webhook processing failed: ${(error as Error).message}`,
      );
      return { success: true };
    }
  }
}
