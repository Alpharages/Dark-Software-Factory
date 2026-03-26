import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AIProvider, TicketStatus, ExecutionStatus, Prisma } from '@/prisma/client';
import { PrismaService } from '@/database/prisma.service';
import { RabbitMQPublisherService } from '@/rabbitmq/rabbitmq-publisher.service';
import { QUEUE_NAMES, ROUTING_KEYS, EXCHANGE_NAMES } from '@/rabbitmq/rabbitmq.config';
import { ComplexityScorerService } from './complexity-scorer.service';
import { ProviderHealthService } from './provider-health.service';
import { AiRoutingConfigService } from './ai-routing-config.service';
import { PromptGeneratorService } from './prompt-generator.service';
import {
  IRoutingRequest,
  IRoutingDecision,
  IRoutingResult,
  IProviderSelection,
  RoutingReason,
  ProviderSelectionReason,
  ComplexityGrade,
} from './interfaces';
// Story 12.5: V3 Services
import { FileLockManagerService } from '@/file-locks/file-lock-manager.service';
import { BranchStrategistService } from '@/github/services/branch-strategist.service';
import { Counter, Histogram } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { ProviderFactoryService } from './provider-factory.service';

/**
 * AI Routing Service
 *
 * Routes tickets to appropriate AI provider based on complexity
 * FR60: System routes to appropriate AI tool based on task complexity
 */
@Injectable()
export class AIRoutingService {
  private readonly logger = new Logger(AIRoutingService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly rabbitMQ: RabbitMQPublisherService,
    private readonly complexityScorer: ComplexityScorerService,
    private readonly providerHealth: ProviderHealthService,
    private readonly promptGenerator: PromptGeneratorService,
    @InjectMetric('ai_routing_total')
    private readonly routingCounter: Counter<string>,
    @InjectMetric('ai_routing_duration_seconds')
    private readonly routingDuration: Histogram<string>,
    @InjectMetric('ai_complexity_score')
    private readonly complexityHisto: Histogram<string>,
    // Story 12.5: V3 Services
    private readonly fileLockManager: FileLockManagerService,
    private readonly branchStrategist: BranchStrategistService,
    @InjectMetric('dsf_ticket_waiting_locks_total')
    private readonly waitingLocksCounter: Counter<string>,
    // Story OS-4.4: Multi-Provider Routing
    private readonly providerFactory: ProviderFactoryService,
    // Story OS-4.5: AI Routing Configuration
    private readonly aiRoutingConfigService: AiRoutingConfigService,
  ) {}

  /**
   * Route a ticket to the appropriate AI provider
   */
  async routeTicket(request: IRoutingRequest): Promise<IRoutingDecision> {
    const endTimer = this.routingDuration.startTimer();
    const { correlationId, ticketId } = request;

    try {
      this.logger.log(`[${correlationId}] Starting routing for ticket ${ticketId}`);

      // 1. Fetch project early to get repository URL for provider factory
      const project = await this.prisma.project.findUnique({
        where: { id: request.projectId },
      });

      if (!project) {
        this.logger.error(
          `[${correlationId}] CRITICAL: Project not found for ID ${request.projectId}. Ticket ${ticketId} cannot be routed.`,
        );
        throw new Error(
          `Project not found: ${request.projectId}. Cannot route ticket without valid project.`,
        );
      }

      // 2. Fetch effective AI routing configuration
      const routingConfig = await this.aiRoutingConfigService.getEffectiveConfig(request.projectId);

      // 3. Calculate complexity once — used for both routing decision and DB persistence
      const complexityBreakdown = this.complexityScorer.calculateComplexity(request, correlationId);

      // 3. Select preferred provider, passing pre-calculated score to avoid double computation
      const selection = await this.providerFactory.selectProvider({
        correlationId,
        ticketId,
        executionId: '', // Placeholder for selection phase
        prompt: request.description,
        repositoryUrl: project.github_repository_url,
        title: request.title,
        acceptanceCriteria: request.acceptanceCriteria,
        tags: request.tags,
        preCalculatedComplexity: complexityBreakdown.totalScore,
        routingConfig,
      });

      const preferredProvider = selection.primary;
      const complexityScore = complexityBreakdown.totalScore;

      this.logger.log(
        `[${correlationId}] Strategy selected ${preferredProvider} (score=${complexityScore}, reason=${selection.reason})`,
      );

      // Record complexity score
      this.complexityHisto.observe(
        { grade: this.getComplexityGrade(complexityScore) },
        complexityScore,
      );

      // 2a. Create Initial Execution Record (Required for File Locks)
      // We create this early to satisfy foreign key constraints in file_lock_queue
      const execution = await this.prisma.execution.create({
        data: {
          ticket_id: ticketId,
          ai_provider: preferredProvider,
          prompt: '', // Will be populated by Story 2.4
          status: ExecutionStatus.QUEUED,
          complexity_score: complexityScore,
          complexity_breakdown: complexityBreakdown as unknown as Prisma.InputJsonObject,
          routing_reason: RoutingReason.COMPLEXITY_LOW, // Placeholder, updated later
          fallback_used: false,
          original_provider: null,
        },
      });

      // AC#6: File Lock Prediction & Acquisition
      const predictionResult = await this.fileLockManager.predictFileModifications({
        ticketId,
        executionId: execution.id,
        repoFullName: project.github_repository_url.replace(/^.*github\.com\//, ''), // Extract org/repo
        ticketTitle: request.title,
        ticketDescription: request.description,
      });
      const filePathsToLock = predictionResult.filePaths;
      const locksResult = await this.fileLockManager.acquireLocks({
        ticketId,
        executionId: execution.id,
        filePaths: filePathsToLock,
      });

      if (!locksResult.acquired) {
        await this.handleLockConflict(request, complexityScore, filePathsToLock);
        // Cancel the execution since we are postponing
        await this.prisma.execution.update({
          where: { id: execution.id },
          data: { status: ExecutionStatus.CANCELLED, error_message: 'Waiting for file locks' },
        });
        return {
          correlationId,
          ticketId,
          selectedProvider: preferredProvider,
          status: 'WAITING_FOR_LOCKS',
          complexityScore,
          complexityBreakdown,
          routingReason: RoutingReason.PRIMARY_UNAVAILABLE, // Re-using as placeholder
          fallbackUsed: false,
          decisionTimestamp: new Date(),
        };
      }

      // 3. Check provider availability
      const availableProvider = await this.providerHealth.getAvailableProvider(preferredProvider);

      if (!availableProvider) {
        // No provider available
        await this.handleNoProviderAvailable(request, complexityScore, complexityBreakdown);
        // Cancel execution as we will retry later with a new request
        await this.prisma.execution.update({
          where: { id: execution.id },
          data: { status: ExecutionStatus.CANCELLED, error_message: 'No AI provider available' },
        });
        throw new Error('No AI provider currently available');
      }

      // 4. Determine routing reason and fallback status
      const { provider } = availableProvider;
      const fallbackUsed = provider !== preferredProvider;
      const routingReason = this.mapProviderSelectionToRoutingReason(selection, fallbackUsed);

      // AC#8: Intelligent Branch Selection
      const dependencies = await this.prisma.ticketDependency.findMany({
        where: { ticket_id: ticketId },
        select: { depends_on: true },
      });
      const dependencyIds = dependencies.map((d) => d.depends_on);
      const branchDecision = await this.branchStrategist.selectBaseBranch(ticketId, dependencyIds);

      // 5. Update execution record with final routing details
      await this.prisma.execution.update({
        where: { id: execution.id },
        data: {
          ai_provider: provider,
          routing_reason: routingReason,
          fallback_used: fallbackUsed,
          original_provider: fallbackUsed ? preferredProvider : null,
          // Story 12.5: Execution context
          base_branch: branchDecision.selectedBranch,
          branch_selection_log: branchDecision.reasoning,
          file_modifications: filePathsToLock,
        },
      });

      // (Step 6-7 remain roughly the same, but we don't need to update locks again)

      // 6. Update ticket status
      await this.prisma.ticket.update({
        where: { id: ticketId },
        data: { status: TicketStatus.QUEUED },
      });

      // 7. Create audit log
      await this.prisma.auditLog.create({
        data: {
          entity_type: 'execution',
          entity_id: execution.id,
          action: 'routed',
          actor_type: 'system',
          after_state: {
            provider,
            complexityScore,
            routingReason,
            fallbackUsed,
          },
        },
      });

      // 8. Publish routing result to execution queue
      // Story 4.9: Project already fetched above
      const routingResult: IRoutingResult = {
        correlationId,
        ticketId,
        executionId: execution.id,
        clickupTaskId: request.clickupTaskId,
        provider,
        complexityScore,
        complexityBreakdown,
        routingReason,
        title: request.title,
        description: request.description,
        acceptanceCriteria: request.acceptanceCriteria,
        projectId: request.projectId,
        repositoryUrl: project.github_repository_url,
        tags: request.tags,
        routedAt: new Date().toISOString(),
      };

      // 8a. Generate prompt now (so ai-execution-queue has everything AIExecutionConsumer needs)
      const generated = await this.promptGenerator.generatePrompt({
        correlationId,
        ticketId,
        clickupTaskId: request.clickupTaskId,
        provider,
        complexityScore,
        complexityBreakdown,
        title: request.title,
        description: request.description,
        acceptanceCriteria: request.acceptanceCriteria,
        projectId: request.projectId,
        tags: request.tags,
        routedAt: routingResult.routedAt,
      });

      // Persist prompt on execution record (execution.prompt is required by OrchestratorService)
      await this.prisma.execution.update({
        where: { id: execution.id },
        data: { prompt: generated.prompt },
      });

      // 8b. Publish AI execution payload (matches src/execution/interfaces/queue.interface.ts)
      const aiExecutionPayload = {
        ticketId,
        executionId: execution.id,
        aiProvider: provider,
        priority: 3,
        prompt: generated.prompt,
        repositoryUrl: routingResult.repositoryUrl,
        projectId: request.projectId,
        allowFallback: true,
      };

      await this.rabbitMQ.publishToQueue(
        QUEUE_NAMES.AI_EXECUTION,
        aiExecutionPayload,
        correlationId,
      );

      // 9. Publish routing event
      await this.rabbitMQ.publishToExchange(
        EXCHANGE_NAMES.ORCHESTRATOR_EVENTS,
        ROUTING_KEYS.AI_ROUTING_COMPLETED,
        routingResult,
        correlationId,
      );

      // 10. Record metrics
      this.routingCounter.inc({
        provider,
        reason: routingReason,
        fallback: fallbackUsed.toString(),
      });

      const decision: IRoutingDecision = {
        correlationId,
        ticketId,
        selectedProvider: provider,
        status: 'QUEUED',
        complexityScore,
        complexityBreakdown,
        routingReason,
        fallbackUsed,
        originalProvider: fallbackUsed ? preferredProvider : undefined,
        decisionTimestamp: new Date(),
      };

      this.logger.log(
        `[${correlationId}] Routing complete: ${provider} (complexity=${complexityScore}, ` +
          `reason=${routingReason}, fallback=${fallbackUsed})`,
      );

      endTimer();
      return decision;
    } catch (_error) {
      endTimer();
      this.logger.error(`[${correlationId}] Routing failed:`, _error);
      throw _error;
    }
  }

  /**
   * Handle case when no provider is available
   */
  private async handleNoProviderAvailable(
    request: IRoutingRequest,
    complexityScore: number,
    _complexityBreakdown: unknown,
  ): Promise<void> {
    const { correlationId, ticketId } = request;

    this.logger.warn(`[${correlationId}] No AI provider available for ticket ${ticketId}`);

    // Publish no-provider event
    await this.rabbitMQ.publishToExchange(
      EXCHANGE_NAMES.ORCHESTRATOR_EVENTS,
      ROUTING_KEYS.AI_ROUTING_NO_PROVIDER,
      { correlationId, ticketId, complexityScore },
      correlationId,
    );

    // Publish to wait queue for delayed retry (5 minutes)
    await this.rabbitMQ.publishToQueue(QUEUE_NAMES.AI_ROUTING_WAIT, request, correlationId);

    this.logger.warn(`[${correlationId}] Ticket ${ticketId} queued for retry in 5 minutes`);

    // Check if we should alert
    const providersToMonitor = [
      AIProvider.CLAUDE_CODE,
      AIProvider.GEMINI,
      AIProvider.CODEX,
      AIProvider.KIMI,
    ];
    for (const provider of providersToMonitor) {
      if (this.providerHealth.shouldAlert(provider)) {
        this.logger.error(
          `[${correlationId}] ALERT: Provider ${provider} unavailable for extended period`,
        );
        // In production, trigger actual alert (Sentry, PagerDuty, etc.)
      }
    }

    // Ticket will be retried by queue mechanism
    this.routingCounter.inc({
      provider: 'none',
      reason: 'no_provider_available',
      fallback: 'false',
    });
  }

  /**
   * Map provider selection to routing reason
   */
  private mapProviderSelectionToRoutingReason(
    selection: IProviderSelection,
    fallbackUsed: boolean,
  ): RoutingReason {
    if (fallbackUsed) {
      return RoutingReason.PRIMARY_UNAVAILABLE;
    }

    if (selection.reason === ProviderSelectionReason.OVERRIDE) {
      return RoutingReason.EXPLICIT_OVERRIDE;
    }

    switch (selection.complexityGrade) {
      case ComplexityGrade.LOW:
        return RoutingReason.COMPLEXITY_LOW;
      case ComplexityGrade.MEDIUM:
        return RoutingReason.COMPLEXITY_MEDIUM;
      case ComplexityGrade.HIGH:
        return RoutingReason.COMPLEXITY_HIGH;
      default:
        return RoutingReason.COMPLEXITY_MEDIUM;
    }
  }

  /**
   * Handle file lock conflict
   */
  private async handleLockConflict(
    request: IRoutingRequest,
    complexityScore: number,
    filePredictions: string[],
  ): Promise<void> {
    const { correlationId, ticketId } = request;

    this.logger.warn(`[${correlationId}] File lock conflict for ticket ${ticketId}`);
    this.waitingLocksCounter.inc();

    // Update ticket status
    await this.prisma.ticket.update({
      where: { id: ticketId },
      data: { status: TicketStatus.WAITING_FOR_LOCKS },
    });

    // Create audit log
    await this.prisma.auditLog.create({
      data: {
        entity_type: 'ticket',
        entity_id: ticketId,
        action: 'lock_conflict_waiting',
        actor_type: 'system',
        after_state: {
          filePredictions,
          status: TicketStatus.WAITING_FOR_LOCKS,
        },
      },
    });

    // Publish to wait queue for delayed retry
    await this.rabbitMQ.publishToQueue(QUEUE_NAMES.AI_ROUTING_WAIT, request, correlationId);

    this.logger.warn(`[${correlationId}] Ticket ${ticketId} queued for retry due to lock conflict`);
  }

  /**
   * Get complexity grade for metrics
   */
  private getComplexityGrade(score: number): string {
    if (score < 5) return 'very_low';
    if (score < 10) return 'low';
    if (score < 15) return 'medium';
    if (score < 18) return 'high';
    return 'very_high';
  }
}
