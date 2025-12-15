import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AIProvider, TicketStatus, ExecutionStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { RabbitMQPublisherService } from '../rabbitmq/rabbitmq-publisher.service';
import { QUEUE_NAMES, ROUTING_KEYS, EXCHANGE_NAMES } from '../rabbitmq/rabbitmq.config';
import { ComplexityScorerService } from './complexity-scorer.service';
import { ProviderHealthService } from './provider-health.service';
import { PromptGeneratorService } from './prompt-generator.service';
import { IRoutingRequest, IRoutingDecision, IRoutingResult, RoutingReason } from './interfaces';
import { Counter, Histogram } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';

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
  ) {}

  /**
   * Route a ticket to the appropriate AI provider
   */
  async routeTicket(request: IRoutingRequest): Promise<IRoutingDecision> {
    const endTimer = this.routingDuration.startTimer();
    const { correlationId, ticketId } = request;

    try {
      this.logger.log(`[${correlationId}] Starting routing for ticket ${ticketId}`);

      // 1. Calculate complexity score
      const complexityBreakdown = this.complexityScorer.calculateComplexity(request, correlationId);
      const complexityScore = complexityBreakdown.totalScore;

      // Record complexity score
      this.complexityHisto.observe(
        { grade: this.getComplexityGrade(complexityScore) },
        complexityScore,
      );

      // 2. Determine preferred provider based on complexity
      const complexityThreshold = this.configService.get<number>(
        'ai.routing.complexityThreshold',
        10,
      );
      const preferredProvider =
        complexityScore >= complexityThreshold
          ? AIProvider.CURSOR_HEADLESS
          : AIProvider.CLAUDE_CODE;

      // 3. Check provider availability
      const availableProvider = await this.providerHealth.getAvailableProvider(preferredProvider);

      if (!availableProvider) {
        // No provider available
        await this.handleNoProviderAvailable(request, complexityScore, complexityBreakdown);
        throw new Error('No AI provider currently available');
      }

      // 4. Determine routing reason and fallback status
      const { provider } = availableProvider;
      const fallbackUsed = provider !== preferredProvider;
      const routingReason = this.determineRoutingReason(
        complexityScore,
        complexityThreshold,
        fallbackUsed,
      );

      // 5. Create execution record
      const execution = await this.prisma.execution.create({
        data: {
          ticket_id: ticketId,
          ai_provider: provider,
          prompt: '', // Will be populated by Story 2.4
          status: ExecutionStatus.QUEUED,
          complexity_score: complexityScore,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          complexity_breakdown: complexityBreakdown as any,
          routing_reason: routingReason,
          fallback_used: fallbackUsed,
          original_provider: fallbackUsed ? preferredProvider : null,
        },
      });

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
        repositoryUrl: this.configService.get<string>('github.defaultRepository', ''),
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
    } catch (error) {
      endTimer();
      this.logger.error(`[${correlationId}] Routing failed:`, error);
      throw error;
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
    for (const provider of [AIProvider.CURSOR_HEADLESS, AIProvider.CLAUDE_CODE]) {
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
   * Determine routing reason
   */
  private determineRoutingReason(
    complexityScore: number,
    threshold: number,
    fallbackUsed: boolean,
  ): RoutingReason {
    if (fallbackUsed) {
      return RoutingReason.PRIMARY_UNAVAILABLE;
    }

    if (complexityScore >= threshold) {
      return RoutingReason.COMPLEXITY_HIGH;
    }

    if (complexityScore < threshold) {
      return RoutingReason.COMPLEXITY_LOW;
    }

    return RoutingReason.COST_OPTIMIZATION;
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
