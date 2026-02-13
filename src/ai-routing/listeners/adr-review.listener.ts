import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventBusService } from '../../common/event-bus.service';
import { AdrReviewedEvent } from '../../architecture-review/events/adr-reviewed.event';
import { ExecutionService } from '../../execution/execution.service';
import { PrismaService } from '../../database/prisma.service';
import { PromptGeneratorService } from '../prompt-generator.service';
import { StartExecutionDto } from '../../execution/dto';
import { AIProvider } from '@/prisma/client';

@Injectable()
export class AdrReviewListener implements OnModuleInit {
  private readonly logger = new Logger(AdrReviewListener.name);

  constructor(
    private readonly executionService: ExecutionService,
    private readonly prisma: PrismaService,
    private readonly promptGenerator: PromptGeneratorService,
    private readonly eventBus: EventBusService,
  ) {}

  onModuleInit() {
    this.eventBus.on('adr.reviewed', (event: AdrReviewedEvent) => this.handleAdrReviewed(event));
  }

  async handleAdrReviewed(event: AdrReviewedEvent) {
    this.logger.log(`Handling ADR review event for ${event.adrId} (Action: ${event.action})`);

    // Only handle REJECT or MODIFY actions for retries
    if (event.action !== 'REJECT' && event.action !== 'MODIFY') {
      return;
    }

    if (!event.ticketId) {
      this.logger.warn(`Cannot retry execution for ADR ${event.adrId}: No Ticket ID`);
      return;
    }

    try {
      // 1. Fetch Ticket details
      const ticket = await this.prisma.ticket.findUnique({
        where: { id: event.ticketId },
      });

      if (!ticket) {
        this.logger.error(`Ticket ${event.ticketId} not found`);
        return;
      }

      // Update ticket status to indicate rework is needed
      // This ensures the status reflects that AI is about to pick it up again or is in queue
      // AWAITING_REWORK is appropriate for "User rejected, needs fix"
      await this.prisma.ticket.update({
        where: { id: ticket.id },
        data: { status: 'AWAITING_REWORK' },
      });

      // 2. Fetch Previous Execution (to get provider and complexity)
      const previousExecution = event.previousExecutionId
        ? await this.executionService.getExecution(event.previousExecutionId)
        : null;

      const provider = previousExecution?.aiProvider || AIProvider.CURSOR_HEADLESS;

      // 3. Generate NEW Prompt with Feedback
      // We need to re-generate the prompt payload.
      // Ideally we should reuse the original input data but we might not have it easily available.
      // For now, we will rely on the prompt generator to fetch fresh context or reuse if we can.
      // Actually, PromptGeneratorService needs input.
      // We can reconstruct minimal input from Ticket.

      // NOTE: This assumes we can start a new execution with just the ticket info + feedback.
      // The Complexity Score might need to be re-evaluated or preserved.
      // We'll reuse 10 (Medium) as default if unknown, or fetch from previous.
      const complexityScore = 15; // Retries are usually complex/high priority

      // 4. Start New Execution
      const correlationId = `retry-${event.adrId}-${Date.now()}`;

      // We need to generate the prompt string first because StartExecutionDto requires it
      // But ExecutionService.startExecution expects the prompt string.
      // So we must generate it here.

      // Re-construct routing input (simplified)
      // In a real scenario, we might want to store the original routing input.
      const promptInput = {
        correlationId,
        ticketId: ticket.id,
        clickupTaskId: ticket.clickup_task_id || 'unknown',
        provider,
        complexityScore,
        complexityBreakdown: {
          fileCount: 0,
          fileCountScore: 0,
          architectureChanges: true,
          architectureScore: 4,
          dependencyLevel: 'high' as const,
          dependencyScore: 4,
          estimatedLoc: 50,
          locScore: 1,
          tagComplexity: 'complex' as const,
          tagScore: 4,
          totalScore: 13,
        },
        title: ticket.title,
        description: ticket.description || '',
        acceptanceCriteria: '', // We might need to fetch this from ticket description parsing
        projectId: ticket.project_id,
        tags: ['retry', 'architecture-feedback'],
        routedAt: new Date().toISOString(),
        feedback: event.notes, // INJECT FEEDBACK HERE
      };

      const generatedPrompt = await this.promptGenerator.generatePrompt(promptInput);

      const startDto: StartExecutionDto = {
        correlationId,
        ticketId: ticket.id,
        clickupTaskId: ticket.clickup_task_id || 'unknown',
        provider,
        prompt: generatedPrompt.prompt,
        complexityScore,
        promptMetadata: {
          promptLength: generatedPrompt.metadata.promptLength,
          estimatedTokens: generatedPrompt.metadata.estimatedTokens,
          templateVersion: generatedPrompt.metadata.templateVersion,
          generatedAt: generatedPrompt.metadata.generatedAt.toISOString(),
        },
        feedback: event.notes,
      };

      await this.executionService.startExecution(startDto);
      this.logger.log(`Triggered retry execution ${correlationId} for Ticket ${ticket.id}`);
    } catch (_error) {
      this.logger.error(
        `Failed to trigger retry for ADR ${event.adrId}: ${(_error as Error).message}`,
      );
    }
  }
}
