import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { ProjectIntegrationService } from './project-integration.service';
import { PMProviderFactory } from './providers/pm-provider.factory';
import { SentryService } from '../common/sentry/sentry.service';

@Injectable()
export class BotAssignmentService {
  private readonly logger = new Logger(BotAssignmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrationService: ProjectIntegrationService,
    private readonly providerFactory: PMProviderFactory,
    private readonly sentry: SentryService,
  ) {}

  /**
   * FR-CS13: Auto-assign DSF bot to PM task when execution starts.
   * Never throws — errors are logged + captured in Sentry but execution is never blocked.
   */
  async assignBotToTask(ticketId: string, projectId: string, correlationId: string): Promise<void> {
    // Step 1: Find ticket to get external task ID
    const ticket = await this.prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket) {
      this.logger.warn(
        `[${correlationId}] CS1-5: Ticket ${ticketId} not found — skipping bot assignment`,
      );
      return;
    }

    // Step 2: Find integration for project
    const integration = await this.integrationService.findFirstByProject(projectId);
    if (!integration) {
      this.logger.warn(
        `[${correlationId}] CS1-5: No ProjectIntegration found for project ${projectId} — skipping bot assignment`,
      );
      return;
    }

    // Step 3: Check bot_user_id
    if (!integration.bot_user_id) {
      this.logger.warn(
        `[${correlationId}] CS1-5: Integration ${integration.id} has no bot_user_id — skipping bot assignment`,
      );
      return;
    }

    // Step 4–5: Get provider and assign
    try {
      const provider = await this.providerFactory.getProvider(integration);
      await provider.assignTask(ticket.clickup_task_id, integration.bot_user_id);
      this.logger.debug(
        `[${correlationId}] CS1-5: Bot (${integration.bot_user_id}) assigned to task ${ticket.clickup_task_id}`,
      );
    } catch (error) {
      this.logger.error(
        `[${correlationId}] CS1-5: assignTask failed for task ${ticket.clickup_task_id}: ${(error as Error).message}`,
      );
      this.sentry.captureException(error as Error);
      // Intentionally not rethrowing — execution must not be blocked by PM sync issues
    }
  }
}
