import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ExecutionStatus } from '@/prisma/client';
import { EventBusService } from '@/common/event-bus.service';
import { PrismaService } from '@/database/prisma.service';
import { DispatcherService } from '@/dispatcher/dispatcher.service';
import { OpenHarnessNeedsInputEvent } from '@/openharness/events/openharness-needs-input.event';
import { ProjectIntegrationService } from './project-integration.service';
import { PMProviderFactory } from './providers/pm-provider.factory';
import { IPMProvider } from './providers/pm-provider.interface';

/**
 * Closes the human-in-the-loop for implement runs that stopped to ask a question.
 *
 * Outbound (event-driven): on `openharness.needs-input`, posts the agent's ask
 * to the PM task as a comment so a PM can answer where they already work.
 *
 * Inbound (polling, local-MVP): every minute, for each execution parked in
 * PAUSED-awaiting-input, reads the task's comments and — if a human has replied
 * *after* our question comment — resumes the ticket via the dispatcher's
 * existing re-dispatch path. The agent re-reads the task (comments included) on
 * the next run, so the answer needs no separate plumbing to reach it.
 *
 * Polling, not webhooks: the deployment runs locally, where ClickUp can't reach
 * an inbound webhook. See [[project_frontend_pivot_gaps]] for the local setup.
 *
 * Wired through the global EventBus so the OpenHarness module never imports
 * Integrations — same decoupling as [[OpenHarnessCodeReadyEvent]].
 */
@Injectable()
export class PmInputResumeService implements OnModuleInit {
  private readonly logger = new Logger(PmInputResumeService.name);

  constructor(
    private readonly eventBus: EventBusService,
    private readonly prisma: PrismaService,
    private readonly integrationService: ProjectIntegrationService,
    private readonly providerFactory: PMProviderFactory,
    private readonly dispatcher: DispatcherService,
  ) {}

  onModuleInit(): void {
    this.eventBus.on('openharness.needs-input', (event: OpenHarnessNeedsInputEvent) => {
      void this.postQuestion(event);
    });
  }

  /** Relay the agent's ask to the PM task as a comment. Best-effort. */
  private async postQuestion(event: OpenHarnessNeedsInputEvent): Promise<void> {
    const tag = `[${event.correlationId}]`;
    try {
      const provider = await this.resolveProvider(event.ticketId);
      if (!provider) {
        this.logger.warn(`${tag} no PM integration for ticket ${event.ticketId} — ask not posted`);
        return;
      }
      await provider.addComment(event.externalTaskId, this.buildComment(event.question));
      this.logger.log(`${tag} posted needs-input question to task ${event.externalTaskId}`);
    } catch (error) {
      // Best-effort: the run is already PAUSED with the ask in error_message.
      this.logger.warn(`${tag} failed to post needs-input question: ${this.msg(error)}`);
    }
  }

  private buildComment(question: string): string {
    return [
      '🤔 DSF needs your input before it can continue',
      '',
      'The implementation run stopped without changing any files because it needs a decision from you. Reply to this task with your answer and DSF will pick it up and resume automatically.',
      '',
      '---',
      question,
    ].join('\n');
  }

  /**
   * Resume any PAUSED-awaiting-input execution whose task has a human reply
   * newer than DSF's own last comment on it.
   */
  @Cron('30 * * * * *') // every minute at :30 — offset from the :00 PM poller
  async pollAwaitingInput(): Promise<void> {
    const paused = await this.prisma.execution.findMany({
      where: {
        status: ExecutionStatus.PAUSED,
        // Only the runs THIS service parked (manual pauses have no such marker).
        error_context: { contains: '"awaitingInput":true' },
      },
      select: { id: true, ticket_id: true },
    });

    for (const execution of paused) {
      try {
        await this.tryResume(execution.id, execution.ticket_id);
      } catch (error) {
        this.logger.warn(`resume check failed for execution ${execution.id}: ${this.msg(error)}`);
      }
    }
  }

  private async tryResume(executionId: string, ticketId: string): Promise<void> {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { clickup_task_id: true },
    });
    if (!ticket?.clickup_task_id) return;

    const provider = await this.resolveProvider(ticketId);
    if (!provider) return;

    const [botId, comments] = await Promise.all([
      provider.getSelf().then((self) => self.id),
      provider.getComments(ticket.clickup_task_id),
    ]);

    // Comments arrive newest-first. Our question comment is the anchor: any
    // non-bot comment newer than the newest bot comment is the human's answer.
    // (If the human replies before DSF's comment lands, they'd re-answer — but
    // DSF always posts before parking, so the anchor exists.)
    const newestBotAt = comments.find((c) => c.authorId === botId)?.createdAt;
    const hasReply = comments.some(
      (c) => c.authorId !== botId && (!newestBotAt || c.createdAt > newestBotAt),
    );
    if (!hasReply) return;

    this.logger.log(
      `Human reply detected on ${ticket.clickup_task_id} — resuming execution ${executionId}`,
    );
    // Clear the marker first so a slow re-dispatch can't be resumed twice by the
    // next tick; the fresh run owns the execution lifecycle from here.
    await this.prisma.execution.update({
      where: { id: executionId },
      data: { error_context: null },
    });
    await this.dispatcher.redispatchImplement(ticketId, `resume-${executionId}`);
  }

  /** Resolve the decrypted PM provider for a ticket's project, or null. */
  private async resolveProvider(ticketId: string): Promise<IPMProvider | null> {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { project_id: true },
    });
    if (!ticket) return null;

    // findFirstByProject already returns decrypted tokens — do NOT decrypt again.
    const integration = await this.integrationService.findFirstByProject(ticket.project_id);
    if (!integration) return null;

    return this.providerFactory.getProvider(integration);
  }

  private msg(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
