import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {
  makeCounterProvider,
  makeHistogramProvider,
  makeGaugeProvider,
} from '@willsoto/nestjs-prometheus';
import { AIRoutingService } from './ai-routing.service';
import { ComplexityScorerService } from './complexity-scorer.service';
import { ProviderHealthService } from './provider-health.service';
import { AIRoutingConsumer } from './ai-routing.consumer';
import { PtyExecutionService } from './services/pty-execution.service';
// Story 2.4: Prompt generation imports
import { PromptGeneratorService } from './prompt-generator.service';
import { CursorPromptBuilder } from './prompt-templates/cursor-prompt.template';
import { ClaudeCodePromptBuilder } from './prompt-templates/claude-prompt.template';
// Story 2.6: AI Execution imports
import { AIExecutionService } from './ai-execution.service';
import {
  WorkspaceService,
  GitOperationsService,
  CursorHeadlessProvider,
  ClaudeCodeProvider,
} from './providers';
// Story 2.8: Orchestration imports
import { OrchestratorService } from './orchestrator.service';
import { ProviderFactoryService } from './provider-factory.service';
import { FallbackStrategyService } from './fallback-strategy.service';
import { DatabaseModule } from '@/database/database.module';
import { RabbitMQModule } from '@/rabbitmq/rabbitmq.module';
import { ExecutionModule } from '@/execution/execution.module';
import { FileLocksModule } from '../file-locks/file-locks.module';
import { GitHubModule } from '../github/github.module';
import { StorageModule } from '../storage/storage.module';
import { AIDecisionLoggerModule } from '../audit/ai-decision-logger.module';
import { AdrParserService } from './adr-parser.service';
import { ArchitectureReviewModule } from '../architecture-review/architecture-review.module';
import { EventBusModule } from '../common/event-bus.module';
import { CostTrackingModule } from '../cost-tracking/cost-tracking.module';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    RabbitMQModule,
    forwardRef(() => ExecutionModule),
    FileLocksModule,
    GitHubModule,
    forwardRef(() => StorageModule),
    AIDecisionLoggerModule,
    ArchitectureReviewModule,
    EventBusModule,
    CostTrackingModule,
  ],
  providers: [
    // Story 2.3: Routing services
    AIRoutingService,
    ComplexityScorerService,
    ProviderHealthService,
    AIRoutingConsumer,
    PtyExecutionService,

    // Story 2.4: Prompt generation services
    PromptGeneratorService,
    CursorPromptBuilder,
    ClaudeCodePromptBuilder,

    // Story 2.6: AI Execution services
    AIExecutionService,
    WorkspaceService,
    GitOperationsService,
    CursorHeadlessProvider,

    // Story 2.7: Claude Code Provider
    ClaudeCodeProvider,

    // Story 2.8: Orchestration Services
    OrchestratorService,
    ProviderFactoryService,
    FallbackStrategyService,
    // OrchestratorConsumer, // DISABLED: Conflicts with AIExecutionConsumer on ai-execution-queue

    // Story 7.1: ADR Parser Service
    AdrParserService,

    // Story 2.3 Metrics
    // Prometheus metrics
    makeCounterProvider({
      name: 'ai_routing_total',
      help: 'Total AI routing decisions',
      labelNames: ['provider', 'reason', 'fallback'],
    }),
    makeCounterProvider({
      name: 'dsf_ticket_waiting_locks_total',
      help: 'Total tickets waiting for file locks',
    }),
    makeHistogramProvider({
      name: 'ai_routing_duration_seconds',
      help: 'AI routing duration in seconds',
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    }),
    makeHistogramProvider({
      name: 'ai_complexity_score',
      help: 'Complexity score distribution',
      labelNames: ['grade'],
      buckets: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20],
    }),
    makeGaugeProvider({
      name: 'ai_provider_health',
      help: 'AI provider health status (1=healthy, 0=unhealthy)',
      labelNames: ['provider'],
    }),
    makeGaugeProvider({
      name: 'ai_provider_active_executions',
      help: 'Number of active executions per provider',
      labelNames: ['provider'],
    }),
    makeCounterProvider({
      name: 'ai_provider_availability_total',
      help: 'Provider availability transitions',
      labelNames: ['provider', 'status'],
    }),

    // Story 2.4 Metrics (ADD)
    makeCounterProvider({
      name: 'prompt_generation_total',
      help: 'Total prompts generated',
      labelNames: ['provider', 'has_context'],
    }),
    makeHistogramProvider({
      name: 'prompt_tokens_histogram',
      help: 'Prompt token count distribution',
      labelNames: ['provider'],
      buckets: [1000, 5000, 10000, 25000, 50000, 100000, 150000, 200000],
    }),
    makeHistogramProvider({
      name: 'prompt_generation_duration_seconds',
      help: 'Prompt generation duration',
      labelNames: ['provider'],
      buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5],
    }),

    // Story 2.6: Cursor Headless Metrics
    makeCounterProvider({
      name: 'cursor_executions_total',
      help: 'Total Cursor CLI executions',
      labelNames: ['status'],
    }),
    makeHistogramProvider({
      name: 'cursor_execution_duration_seconds',
      help: 'Cursor execution duration in seconds',
      labelNames: ['status'],
      buckets: [10, 30, 60, 120, 180, 240, 300, 600],
    }),
    makeGaugeProvider({
      name: 'cursor_active_executions',
      help: 'Currently active Cursor executions',
    }),
    makeGaugeProvider({
      name: 'cursor_workspaces_active',
      help: 'Currently active workspaces',
    }),
    makeCounterProvider({
      name: 'cursor_workspace_operations_total',
      help: 'Workspace operations count',
      labelNames: ['operation', 'status'],
    }),

    // Story 2.7: Claude Code Metrics
    makeCounterProvider({
      name: 'claude_executions_total',
      help: 'Total Claude API executions',
      labelNames: ['status'],
    }),
    makeHistogramProvider({
      name: 'claude_execution_duration_seconds',
      help: 'Claude execution duration in seconds',
      labelNames: ['status'],
      buckets: [5, 15, 30, 60, 90, 120],
    }),
    makeGaugeProvider({
      name: 'claude_active_executions',
      help: 'Currently active Claude executions',
    }),
    makeCounterProvider({
      name: 'claude_tokens_total',
      help: 'Total tokens used',
      labelNames: ['type'], // input, output
    }),
    makeGaugeProvider({
      name: 'claude_cost_cents',
      help: 'Estimated cost in cents',
    }),

    // Story 2.8: Orchestration Metrics
    makeCounterProvider({
      name: 'orchestrator_executions_total',
      help: 'Total orchestrated executions',
      labelNames: ['status', 'provider'],
    }),
    makeHistogramProvider({
      name: 'orchestrator_execution_duration_seconds',
      help: 'Orchestration duration in seconds',
      labelNames: ['status'],
      buckets: [30, 60, 120, 180, 300, 600],
    }),
    makeGaugeProvider({
      name: 'orchestrator_cost_cents',
      help: 'Estimated cost in cents',
    }),
    makeCounterProvider({
      name: 'orchestrator_provider_selections_total',
      help: 'Provider selection decisions',
      labelNames: ['reason', 'provider'],
    }),
    makeCounterProvider({
      name: 'orchestrator_fallback_total',
      help: 'Fallback triggers',
      labelNames: ['from_provider', 'to_provider', 'reason'],
    }),
    makeCounterProvider({
      name: 'orchestrator_fallback_success_total',
      help: 'Successful fallbacks',
      labelNames: ['from_provider', 'to_provider'],
    }),
    makeHistogramProvider({
      name: 'orchestrator_fallback_duration_seconds',
      help: 'Fallback execution duration',
      labelNames: ['from_provider', 'to_provider'],
      buckets: [30, 60, 120, 180, 300],
    }),

    // Story 7.1: ADR Metrics
    makeCounterProvider({
      name: 'adr_creation_total',
      help: 'Total ADRs created by AI',
      labelNames: ['risk_level'],
    }),
  ],
  exports: [
    // Story 2.3: Routing exports
    AIRoutingService,
    ComplexityScorerService,
    ProviderHealthService,
    PtyExecutionService,
    // Story 2.4: Prompt generation exports
    PromptGeneratorService,
    CursorPromptBuilder,
    ClaudeCodePromptBuilder,
    // Story 2.6: AI Execution exports
    AIExecutionService,
    WorkspaceService,
    GitOperationsService,
    CursorHeadlessProvider,
    // Story 2.7: Claude Code exports
    ClaudeCodeProvider,
    // Story 2.8: Orchestration exports
    OrchestratorService,
    ProviderFactoryService,
    FallbackStrategyService,
  ],
})
export class AiRoutingModule {}
