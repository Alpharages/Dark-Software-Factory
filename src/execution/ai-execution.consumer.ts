import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// AIProvider type comes from IAIExecutionPayload interface
import type { ConsumeMessage, Channel } from 'amqplib';
import { Counter, Gauge, Histogram } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { RabbitMQService } from '@/rabbitmq/rabbitmq.service';
import { QUEUE_NAMES } from '@/rabbitmq/rabbitmq.config';
import { ExecutionTrackerService } from './execution-tracker.service';
import {
  IAIExecutionMessage,
  IConsumerState,
  IProcessingResult,
  IExecutionFailure,
} from './interfaces';
import { OrchestratorService } from '@/ai-routing/orchestrator.service';
import { DEFAULT_COMPLEXITY_SCORE, DEFAULT_ESTIMATED_OUTPUT_TOKENS } from './execution.constants';
// Story 11.4: AI Decision Audit Logging
import { AIDecisionLoggerService } from '@/audit/ai-decision-logger.service';
// Story 13.3: AI Cost Tracking & Optimization
import { AICostTrackerService } from '@/cost-tracking/ai-cost-tracker.service';
import { CostOptimizerService } from '@/cost-tracking/cost-optimizer.service';
import { SentryService } from '@/common/sentry/sentry.service';
import { ErrorSeverity } from '@/common/sentry/sentry.constants';
// Story 7.7: AI Capability Management & Limitations
import { AiCapabilityTrackerService } from '@/architecture-review/capabilities/ai-capability-tracker.service';
import { ClickUpService } from '@/clickup/clickup.service';
import { BotAssignmentService } from '@/integrations/bot-assignment.service';
import { Prisma } from '@/prisma/client';
type Decimal = Prisma.Decimal;
const Decimal = Prisma.Decimal;

/**
 * AI Execution Consumer
 *
 * Consumes messages from ai-execution-queue and processes AI executions.
 * Implements manual acknowledgment, error handling, and metrics.
 *
 * Story 2.10: RabbitMQ AI Execution Queue Processing
 *
 * Architecture Reference:
 * - Prefetch count: 1 (process one at a time)
 * - Manual acknowledgment required
 * - Dead letter after 3 retries
 * - Exponential backoff for transient failures
 *
 * **Design Decision:** Uses raw `channel.consume()` instead of `@MessagePattern`
 * decorator because manual acknowledgment control is required for:
 * - Explicit ack/nack based on processing result
 * - Requeue decisions based on error type
 * - DLQ routing for permanent failures
 * @MessagePattern auto-acks which doesn't meet our reliability requirements.
 */
@Injectable()
export class AIExecutionConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AIExecutionConsumer.name);

  /** Consumer state for health checks */
  private consumerState: IConsumerState = {
    consumerTag: '',
    isActive: false,
    startedAt: new Date(),
    messagesProcessed: 0,
    messagesFailed: 0,
    currentMessageId: null,
  };

  /** Processing metrics */
  private processingTimes: number[] = [];
  private readonly MAX_PROCESSING_TIMES = 100;

  /** Queue monitoring interval */
  private monitoringInterval?: NodeJS.Timeout;

  constructor(
    private readonly config: ConfigService,
    private readonly rabbitmq: RabbitMQService,
    private readonly executionTracker: ExecutionTrackerService,
    @Inject(forwardRef(() => OrchestratorService))
    private readonly orchestrator: OrchestratorService,
    // Story 11.4: AI Decision Audit Logging
    private readonly aiDecisionLogger: AIDecisionLoggerService,
    // Story 13.3: AI Cost Tracking & Optimization
    private readonly aiCostTracker: AICostTrackerService,
    // Story 7.7: AI Capability Management & Limitations
    private readonly capabilityTracker: AiCapabilityTrackerService,
    private readonly costOptimizer: CostOptimizerService,
    private readonly sentry: SentryService,
    private readonly clickup: ClickUpService,
    private readonly botAssignment: BotAssignmentService,
    @InjectMetric('queue_messages_consumed_total')
    private readonly consumedCounter: Counter<string>,
    @InjectMetric('queue_messages_failed_total')
    private readonly failedCounter: Counter<string>,
    @InjectMetric('queue_processing_duration_seconds')
    private readonly processingHistogram: Histogram<string>,
    @InjectMetric('queue_depth')
    private readonly queueDepthGauge: Gauge<string>,
    @InjectMetric('queue_consumer_count')
    private readonly consumerCountGauge: Gauge<string>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.startConsuming();
    this.startQueueMonitoring();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }
    await this.stopConsuming();
  }

  /**
   * Start consuming messages from the queue
   */
  private async startConsuming(): Promise<void> {
    try {
      const channel = this.rabbitmq.getChannel();
      const prefetch = this.config.get<number>('AI_EXECUTION_PREFETCH', 1);
      const consumerTag = this.config.get<string>(
        'AI_EXECUTION_CONSUMER_TAG',
        'ai-execution-consumer',
      );

      // Set prefetch to process one message at a time
      await channel.prefetch(prefetch);

      this.logger.log(`Starting AI execution consumer (prefetch: ${prefetch})`);

      // Start consuming with manual acknowledgment
      const { consumerTag: tag } = await channel.consume(
        QUEUE_NAMES.AI_EXECUTION,
        async (msg: ConsumeMessage | null) => {
          if (!msg) return;

          const startTime = Date.now();
          let messageData: IAIExecutionMessage | null = null;

          try {
            // Parse message
            messageData = JSON.parse(msg.content.toString()) as IAIExecutionMessage;
            const { correlationId, payload } = messageData;

            this.consumerState.currentMessageId = messageData.messageId;
            // Correlation ID is tracked via middleware; log it for reference

            this.logger.log(
              `[${correlationId}] Processing execution ${payload.executionId} ` +
                `(provider: ${payload.aiProvider}, priority: ${payload.priority})`,
            );

            // Process the execution
            const result = await this.processExecution(messageData);

            // Record metrics
            const duration = Date.now() - startTime;
            this.recordProcessingTime(duration);

            if (result.success) {
              this.logger.log(
                `[${correlationId}] Execution ${payload.executionId} completed ` +
                  `(${duration}ms)`,
              );

              // Acknowledge message
              channel.ack(msg);
              this.consumerState.messagesProcessed++;

              this.consumedCounter.inc({
                queue: QUEUE_NAMES.AI_EXECUTION,
                status: 'success',
                provider: payload.aiProvider,
              });
            } else {
              // Processing failed - check if retryable
              await this.handleProcessingFailure(msg, channel, messageData, result);
            }

            this.processingHistogram.observe({ queue: QUEUE_NAMES.AI_EXECUTION }, duration / 1000);
          } catch (error: unknown) {
            const err = error as Error & { name?: string };
            // Unexpected error - reject message
            this.logger.error(
              `[${messageData?.correlationId || 'unknown'}] Consumer error: ${err.message}`,
              err.stack,
            );

            const shouldRequeue = this.shouldRequeueOnError(err);
            channel.nack(msg, false, shouldRequeue);

            this.consumerState.messagesFailed++;
            this.failedCounter.inc({
              queue: QUEUE_NAMES.AI_EXECUTION,
              error_type: err.name || 'UnknownError',
            });
          } finally {
            this.consumerState.currentMessageId = null;
          }
        },
        { noAck: false, consumerTag },
      );

      this.consumerState.consumerTag = tag;
      this.consumerState.isActive = true;
      this.consumerState.startedAt = new Date();

      this.logger.log(`✅ AI execution consumer started (tag: ${tag})`);
    } catch (_error: unknown) {
      const err = _error as Error;
      this.logger.error(`Failed to start consumer: ${err.message}`);
      throw _error;
    }
  }

  /**
   * Process a single AI execution
   */
  private async processExecution(message: IAIExecutionMessage): Promise<IProcessingResult> {
    const { correlationId, payload } = message;
    const { executionId, prompt, repositoryUrl } = payload;
    const startTime = Date.now();

    try {
      // If we get duplicate/late deliveries, don't try to "restart" a terminal execution.
      const existing = await this.executionTracker.getExecution(executionId);
      if (
        existing?.status === 'COMPLETED' ||
        existing?.status === 'FAILED' ||
        existing?.status === 'TIMEOUT' ||
        existing?.status === 'CANCELLED'
      ) {
        this.logger.warn(
          `[${correlationId}] Skipping message: execution ${executionId} already terminal (${existing.status})`,
        );
        return {
          success: true,
          executionId,
          durationMs: Date.now() - startTime,
          executedBy: payload.aiProvider,
        };
      }

      // 1. Mark execution as in-progress
      await this.executionTracker.markInProgress(executionId, correlationId);

      // CS1-5: Auto-assign bot to task on execution start (FR-CS13)
      await this.botAssignment.assignBotToTask(payload.ticketId, payload.projectId, correlationId);

      // Story 11.4: Log AI provider selection decision
      await this.aiDecisionLogger.logDecision({
        agentName: 'AIExecutionConsumer',
        action: 'ai_provider_selection',
        reasoning: `Processing AI execution request. Provider: ${payload.aiProvider}. Ticket requires code generation via AI orchestration.`,
        ticketId: payload.ticketId,
        executionId,
        inputData: {
          ticketId: payload.ticketId,
          provider: payload.aiProvider,
          priority: payload.priority,
          allowFallback: payload.allowFallback ?? true,
        },
        outputData: {
          selectedProvider: payload.aiProvider,
          executionStarted: true,
        },
        confidence: 0.9,
      });

      // Story 11.4: Log prompt generation
      await this.aiDecisionLogger.logDecision({
        agentName: 'AIExecutionConsumer',
        action: 'prompt_generation',
        reasoning: `Extracted prompt from ticket for AI code generation. Repository: ${repositoryUrl || 'workspace'}`,
        ticketId: payload.ticketId,
        executionId,
        inputData: {
          promptLength: prompt.length,
          hasRepository: !!repositoryUrl,
        },
        outputData: {
          promptGenerated: true,
          readyForExecution: true,
        },
        confidence: 0.95,
      });

      // =================================================================
      // Story 13.3: Cost Estimation & Model Selection
      // =================================================================
      let selectedModel: string = 'gpt-4o'; // Default model (will be overridden by CostOptimizer)
      let estimatedCost: Decimal | null = null;
      try {
        this.logger.log(`[COST_ESTIMATION] Starting cost estimation for execution ${executionId}`);
        await this.executionTracker.emitProgress(
          executionId,
          payload.ticketId,
          payload.projectId,
          'Cost Estimation',
          5,
        );

        // Get complexity score from execution (populated by Story 2.3 ComplexityScorerService)
        const execution = await this.executionTracker.getExecution(executionId);
        const complexityScore = execution?.complexity_score || DEFAULT_COMPLEXITY_SCORE;

        selectedModel = this.costOptimizer.selectOptimalModel(complexityScore);
        this.logger.log(
          `[MODEL_SELECTED] Using ${selectedModel} (complexity: ${complexityScore}) for execution ${executionId}`,
        );
        await this.executionTracker.emitProgress(
          executionId,
          payload.ticketId,
          payload.projectId,
          'Model Selection',
          8,
        );

        // Log model selection decision
        await this.aiDecisionLogger.logDecision({
          agentName: 'AIExecutionConsumer',
          action: 'model_selection',
          reasoning: `Selected ${selectedModel} based on complexity score ${complexityScore}. Cost optimization enabled.`,
          ticketId: payload.ticketId,
          executionId,
          inputData: {
            complexityScore,
          },
          outputData: {
            selectedModel,
          },
          confidence: 0.9,
        });

        // Estimate cost BEFORE execution (AC#1)
        estimatedCost = this.aiCostTracker.estimateCost(
          prompt,
          selectedModel,
          DEFAULT_ESTIMATED_OUTPUT_TOKENS,
        );

        // Log estimated cost (AC#3)
        await this.aiDecisionLogger.logDecision({
          agentName: 'AIExecutionConsumer',
          action: 'cost_estimation_pre_execution',
          reasoning: `Estimated cost before execution: $${estimatedCost.toFixed(6)} USD. Model: ${selectedModel}. Prompt: ${prompt.length} chars (~${Math.floor(prompt.length / 4)} tokens). Output: ~${DEFAULT_ESTIMATED_OUTPUT_TOKENS} tokens.`,
          ticketId: payload.ticketId,
          executionId,
          inputData: {
            model: selectedModel,
            promptLength: prompt.length,
            estimatedInputTokens: Math.floor(prompt.length / 4),
            estimatedOutputTokens: DEFAULT_ESTIMATED_OUTPUT_TOKENS,
          },
          outputData: {
            estimatedCostUsd: estimatedCost.toNumber(),
          },
          confidence: 0.7, // Estimates have lower confidence
        });

        this.logger.log(
          `[${correlationId}] Estimated cost: $${estimatedCost.toFixed(6)} USD (${selectedModel})`,
        );

        // Story 6-R-1: Automatic Cost Cap Enforcement
        const budgetCheck = await this.aiCostTracker.checkBudgetAvailability(
          payload.ticketId,
          estimatedCost,
        );

        if (!budgetCheck.allowed) {
          const reason = budgetCheck.reason || 'Project budget exceeded';
          this.logger.warn(`[${correlationId}] Execution blocked: ${reason}`);

          // 1. Alert PM via ClickUp
          await this.clickup.addComment(
            payload.ticketId,
            `🚨 **AI Execution Blocked: Budget Exceeded**\\n\\n` +
              `The requested AI operation was blocked. Reason: ${reason}\\n\\n` +
              `**Analysis:**\\n` +
              `- Budget: $${budgetCheck.budget?.toFixed(2)}\\n` +
              `- Current Spend: $${budgetCheck.spend?.toFixed(2)}\\n` +
              `- Estimated Cost: $${estimatedCost.toFixed(4)}\\n\\n` +
              `Please increase the project budget or optimize usage to proceed.`,
          );

          // 2. Log Decision
          await this.aiDecisionLogger.logDecision({
            agentName: 'AIExecutionConsumer',
            action: 'execution_blocked_budget',
            reasoning: `Blocking execution due to budget overrun. ${reason}`,
            ticketId: payload.ticketId,
            executionId,
            inputData: {
              estimatedCost: estimatedCost.toNumber(),
              budget: budgetCheck.budget,
              spend: budgetCheck.spend,
            },
            outputData: {
              blocked: true,
              reason,
            },
            confidence: 1.0,
          });

          // 3. Mark as Failed
          const failure: IExecutionFailure = {
            executionId,
            errorMessage: reason,
            isRetryable: false, // Budget issues aren't transient
            errorCode: 'BUDGET_EXCEEDED',
          };
          await this.executionTracker.failExecution(failure, correlationId);

          return {
            success: false,
            executionId,
            durationMs: Date.now() - startTime,
            errorMessage: reason,
            errorCode: 'BUDGET_EXCEEDED',
          };
        }

        // Budget check passed
        this.logger.log(`[BUDGET_CHECK] Budget check passed for execution ${executionId}`);
        await this.executionTracker.emitProgress(
          executionId,
          payload.ticketId,
          payload.projectId,
          'Budget Check',
          10,
        );
      } catch (_error) {
        const err = _error as Error;
        this.logger.error(`[${correlationId}] Cost estimation failed: ${err.message}`);

        // H8 Fix: Alert to Sentry for silent failures
        this.sentry.captureMessage(
          `Cost estimation failed for execution ${executionId}: ${err.message}`,
          ErrorSeverity.HIGH,
        );

        // H8 Fix: Log failure to AIDecisionLogger for audit trail
        await this.aiDecisionLogger.logDecision({
          agentName: 'AIExecutionConsumer',
          action: 'cost_estimation_failed',
          reasoning: `Cost estimation failed: ${err.message}. Execution will proceed WITHOUT cost tracking.`,
          ticketId: payload.ticketId,
          executionId,
          inputData: {
            errorMessage: err.message,
          },
          outputData: {
            fallbackModel: selectedModel,
          },
          confidence: 0.0, // Failure = no confidence
        });
        // Continue execution even if cost estimation fails
      }

      // 2. Execute via OrchestratorService with selected model
      this.logger.log(
        `[ORCHESTRATOR] Starting AI execution via ${payload.aiProvider} for execution ${executionId}`,
      );
      const result = await this.orchestrator.execute({
        correlationId,
        executionId,
        ticketId: payload.ticketId,
        prompt,
        repositoryUrl,
        allowFallback: payload.allowFallback ?? true,
        selectedModel, // Story 13.3: Pass selected model to orchestrator
        providerOverride: payload.aiProvider, // Respect the routing service's decision
      });

      if (result.success) {
        // Story 13.3: Log actual cost AFTER execution (AC#1, #3)
        try {
          if (result.tokensInput && result.tokensOutput && selectedModel) {
            // Calculate actual cost
            const actualCost = this.aiCostTracker.calculateUSD(
              selectedModel,
              result.tokensInput,
              result.tokensOutput,
            );

            // Calculate cost variance (AC#3: Alert if actual > 150% or 200% of estimate)
            let costVariance = 0;
            if (estimatedCost) {
              costVariance =
                (actualCost.toNumber() - estimatedCost.toNumber()) / estimatedCost.toNumber();

              // H4 Fix: Log variance alerts to AIDecisionLogger for audit trail
              if (costVariance > 2.0) {
                this.logger.error(
                  `[${correlationId}] CRITICAL: Cost variance >200%! Estimated: $${estimatedCost.toFixed(6)}, Actual: $${actualCost.toFixed(6)}`,
                );
                await this.aiDecisionLogger.logDecision({
                  agentName: 'AIExecutionConsumer',
                  action: 'cost_variance_alert_critical',
                  reasoning: `CRITICAL cost variance detected: Actual cost is ${(costVariance * 100).toFixed(1)}% higher than estimate. This indicates estimation model needs calibration.`,
                  ticketId: payload.ticketId,
                  executionId,
                  inputData: {
                    estimatedCostUsd: estimatedCost.toNumber(),
                    actualCostUsd: actualCost.toNumber(),
                    variancePercent: costVariance * 100,
                  },
                  outputData: {
                    alertLevel: 'CRITICAL',
                  },
                  confidence: 0.95,
                });
              } else if (costVariance > 1.5) {
                this.logger.warn(
                  `[${correlationId}] WARNING: Cost variance >150%. Estimated: $${estimatedCost.toFixed(6)}, Actual: $${actualCost.toFixed(6)}`,
                );
                await this.aiDecisionLogger.logDecision({
                  agentName: 'AIExecutionConsumer',
                  action: 'cost_variance_alert_warning',
                  reasoning: `Cost variance warning: Actual cost is ${(costVariance * 100).toFixed(1)}% higher than estimate. Monitor for systematic estimation drift.`,
                  ticketId: payload.ticketId,
                  executionId,
                  inputData: {
                    estimatedCostUsd: estimatedCost.toNumber(),
                    actualCostUsd: actualCost.toNumber(),
                    variancePercent: costVariance * 100,
                  },
                  outputData: {
                    alertLevel: 'WARNING',
                  },
                  confidence: 0.9,
                });
              }
            }

            // Log actual cost with variance to AIDecisionLogger (AC#3)
            await this.aiDecisionLogger.logDecision({
              agentName: 'AIExecutionConsumer',
              action: 'cost_actuals_post_execution',
              reasoning: `Actual cost after execution: $${actualCost.toFixed(6)} USD. Variance from estimate: ${costVariance > 0 ? '+' : ''}${(costVariance * 100).toFixed(1)}%. Model: ${selectedModel}. Input: ${result.tokensInput} tokens, Output: ${result.tokensOutput} tokens.`,
              ticketId: payload.ticketId,
              executionId,
              inputData: {
                model: selectedModel,
                tokensInput: result.tokensInput,
                tokensOutput: result.tokensOutput,
                estimatedCostUsd: estimatedCost?.toNumber() || 0,
              },
              outputData: {
                actualCostUsd: actualCost.toNumber(),
                costVariancePercent: costVariance * 100,
              },
              confidence: 0.95, // Actuals have high confidence
            });

            // Log to database & Prometheus (AC#1)
            await this.aiCostTracker.logCost({
              executionId,
              ticketId: payload.ticketId,
              provider: payload.aiProvider,
              model: selectedModel,
              inputTokens: result.tokensInput,
              outputTokens: result.tokensOutput,
              agentName: 'AIExecutionConsumer',
              operationType: 'code_generation',
            });
          }
        } catch (_error) {
          const err = _error as Error;
          this.logger.error(`[${correlationId}] Failed to log actual cost: ${err.message}`);
          // M3 Fix: Alert on cost logging failure (budget tracking broken)
          this.sentry.captureMessage(
            `Cost logging failed for execution ${executionId}: ${err.message}. Budget tracking incomplete!`,
            ErrorSeverity.HIGH,
          );
        }

        // Story 11.4: Log successful execution
        await this.aiDecisionLogger.logDecision({
          agentName: 'AIExecutionConsumer',
          action: 'ai_execution_complete',
          reasoning: `AI execution completed successfully. Generated code changes across ${result.filesChanged?.length || 0} files. Provider: ${result.executedBy}. Fallback used: ${result.usedFallback}.`,
          ticketId: payload.ticketId,
          executionId,
          inputData: {
            provider: result.executedBy,
            usedFallback: result.usedFallback,
            durationMs: result.durationMs,
          },
          outputData: {
            filesChanged: result.filesChanged?.length || 0,
            confidenceScore: result.confidenceScore || 0.8,
            success: true,
          },
          confidence: result.confidenceScore || 0.8,
        });

        // Note: execution status and execution.completed EventBus event are handled by
        // AIExecutionService.executeWithProvider() → ExecutionService.completeExecution().
        // Emitting here again would cause a duplicate QA check to be published.

        // Story 7.7: Track AI capability success (C2 fix)
        await this.capabilityTracker.trackExecution(true, payload.prompt);

        return {
          success: true,
          executionId,
          durationMs: Date.now() - startTime,
          executedBy: result.executedBy,
        };
      } else {
        // Story 11.4: Log execution failure
        const isRetryable = this.isRetryableError(result.error?.code);
        await this.aiDecisionLogger.logDecision({
          agentName: 'AIExecutionConsumer',
          action: 'ai_execution_failed',
          reasoning: `AI execution failed: ${result.error?.message || 'Unknown error'}. Decision: ${isRetryable ? 'Retryable' : 'Permanent failure'}.`,
          ticketId: payload.ticketId,
          executionId,
          inputData: {
            errorCode: result.error?.code,
            errorMessage: result.error?.message,
          },
          outputData: {
            isRetryable,
            willRetry: isRetryable,
          },
          confidence: 0.85,
        });

        // 4. Mark as failed
        const failure: IExecutionFailure = {
          executionId,
          errorMessage: result.error?.message || 'Unknown error',
          isRetryable: this.isRetryableError(result.error?.code),
          errorCode: result.error?.code,
        };
        await this.executionTracker.failExecution(failure, correlationId);

        // Story 7.7: Track AI capability failure (C2 fix)
        await this.capabilityTracker.trackExecution(
          false,
          payload.prompt,
          undefined,
          result.error?.message,
        );

        return {
          success: false,
          executionId,
          durationMs: Date.now() - startTime,
          errorMessage: result.error?.message,
          errorCode: result.error?.code,
        };
      }
    } catch (error: unknown) {
      const err = error as Error & { code?: string };
      this.logger.error(`[${correlationId}] Execution ${executionId} threw error: ${err.message}`);

      const failure: IExecutionFailure = {
        executionId,
        errorMessage: err.message,
        isRetryable: this.isRetryableError(err.code),
        errorCode: err.code || 'EXECUTION_ERROR',
      };
      await this.executionTracker.failExecution(failure, correlationId);

      return {
        success: false,
        executionId,
        durationMs: Date.now() - startTime,
        errorMessage: err.message,
        errorCode: err.code || 'EXECUTION_ERROR',
      };
    }
  }

  /**
   * Handle processing failure - determine retry or DLQ
   */
  private async handleProcessingFailure(
    msg: ConsumeMessage,
    channel: Channel,
    messageData: IAIExecutionMessage,
    result: IProcessingResult,
  ): Promise<void> {
    const { correlationId } = messageData;
    const currentRetryCount = Number(msg.properties.headers?.['x-retry-count'] ?? 0);
    const nextRetryCount = currentRetryCount + 1;
    const maxRetries = 3;

    this.logger.warn(
      `[${correlationId}] Execution failed (attempt ${nextRetryCount}/${maxRetries}): ${result.errorMessage}`,
    );

    if (nextRetryCount < maxRetries && this.isRetryableError(result.errorCode)) {
      // Re-publish with incremented retry header so it can eventually DLQ.
      // Note: In production we should use a delayed retry/backoff mechanism.
      const newHeaders = {
        ...(msg.properties.headers ?? {}),
        'x-retry-count': nextRetryCount,
      };

      channel.sendToQueue(QUEUE_NAMES.AI_EXECUTION, msg.content, {
        persistent: true,
        contentType: msg.properties.contentType,
        correlationId: msg.properties.correlationId,
        messageId: msg.properties.messageId,
        timestamp: msg.properties.timestamp,
        appId: msg.properties.appId,
        headers: newHeaders,
      });

      channel.ack(msg);
      this.logger.log(
        `[${correlationId}] Message republished for retry (attempt ${nextRetryCount + 1})`,
      );
    } else {
      // Max retries exceeded or non-retryable - send to DLQ
      channel.nack(msg, false, false); // Don't requeue - goes to DLQ

      this.consumerState.messagesFailed++;

      this.logger.error(`[${correlationId}] Message sent to DLQ after ${nextRetryCount} attempts`);

      this.failedCounter.inc({
        queue: QUEUE_NAMES.AI_EXECUTION,
        error_type: result.errorCode || 'UNKNOWN',
        final: 'true',
      });
    }
  }

  /**
   * Check if error is retryable
   */
  private isRetryableError(errorCode?: string): boolean {
    const nonRetryable = [
      'INVALID_PROMPT',
      'INVALID_REPOSITORY',
      'AUTHENTICATION_ERROR',
      'PERMISSION_DENIED',
      'CLI_NOT_FOUND',
      'CANCELLED',
    ];
    return !nonRetryable.includes(errorCode || '');
  }

  /**
   * Check if error should trigger requeue (transient network issues)
   */
  private shouldRequeueOnError(_error: Error): boolean {
    const transientPatterns = ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'Connection closed'];
    return transientPatterns.some((p) => _error.message.includes(p));
  }

  /**
   * Record processing time for rate calculation
   */
  private recordProcessingTime(durationMs: number): void {
    this.processingTimes.push(durationMs);
    if (this.processingTimes.length > this.MAX_PROCESSING_TIMES) {
      this.processingTimes.shift();
    }
  }

  /**
   * Start queue depth monitoring
   */
  private startQueueMonitoring(): void {
    const intervalMs = this.config.get<number>('AI_EXECUTION_MONITOR_INTERVAL_MS', 10000);
    this.monitoringInterval = setInterval(async () => {
      try {
        const stats = await this.rabbitmq.getQueueStats(QUEUE_NAMES.AI_EXECUTION);

        this.queueDepthGauge.set({ queue: QUEUE_NAMES.AI_EXECUTION }, stats.messageCount);

        this.consumerCountGauge.set({ queue: QUEUE_NAMES.AI_EXECUTION }, stats.consumerCount);
      } catch {
        // Silently ignore monitoring errors
      }
    }, intervalMs);
  }

  /**
   * Stop consuming messages
   */
  private async stopConsuming(): Promise<void> {
    if (this.consumerState.consumerTag && this.consumerState.isActive) {
      try {
        const channel = this.rabbitmq.getChannel();
        await channel.cancel(this.consumerState.consumerTag);
      } catch (_error: unknown) {
        // Silently ignore if channel is already closed or invalid during shutdown
        const errorMessage = _error instanceof Error ? _error.message : String(_error);
        this.logger.debug(`Could not cancel consumer tag during shutdown: ${errorMessage}`);
      } finally {
        this.consumerState.isActive = false;
        this.logger.log('AI execution consumer stopped');
      }
    }
  }

  /**
   * Get consumer state for health checks
   */
  getConsumerState(): IConsumerState {
    return { ...this.consumerState };
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(): Promise<{
    messageCount: number;
    consumerCount: number;
    processingRate: number;
    avgProcessingTimeMs: number;
  }> {
    const stats = await this.rabbitmq.getQueueStats(QUEUE_NAMES.AI_EXECUTION);

    const avgTime =
      this.processingTimes.length > 0
        ? this.processingTimes.reduce((a, b) => a + b, 0) / this.processingTimes.length
        : 0;

    const processingRate =
      this.processingTimes.length > 0
        ? 1000 / avgTime // Messages per second
        : 0;

    return {
      ...stats,
      processingRate: Math.round(processingRate * 100) / 100,
      avgProcessingTimeMs: Math.round(avgTime),
    };
  }
}
