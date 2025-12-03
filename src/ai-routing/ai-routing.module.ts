import { Module } from '@nestjs/common';
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
// ADD: Prompt generation imports
import { PromptGeneratorService } from './prompt-generator.service';
import { CursorPromptBuilder } from './prompt-templates/cursor-prompt.template';
import { ClaudeCodePromptBuilder } from './prompt-templates/claude-prompt.template';
import { DatabaseModule } from '../database/database.module';
import { RabbitMQModule } from '../rabbitmq/rabbitmq.module';

/**
 * AI Routing Module
 *
 * FR60: System routes to appropriate AI tool based on task complexity
 *
 * Components:
 * - ComplexityScorerService: Calculate ticket complexity (0-20)
 * - ProviderHealthService: Track AI provider availability
 * - AIRoutingService: Main routing logic
 * - AIRoutingConsumer: Process routing queue
 */
@Module({
  imports: [ConfigModule, DatabaseModule, RabbitMQModule],
  providers: [
    AIRoutingService,
    ComplexityScorerService,
    ProviderHealthService,
    AIRoutingConsumer,

    // Story 2.4: Prompt generation services (ADD)
    PromptGeneratorService,
    CursorPromptBuilder,
    ClaudeCodePromptBuilder,

    // Story 2.3 Metrics
    // Prometheus metrics
    makeCounterProvider({
      name: 'ai_routing_total',
      help: 'Total AI routing decisions',
      labelNames: ['provider', 'reason', 'fallback'],
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
  ],
  exports: [
    AIRoutingService,
    ComplexityScorerService,
    ProviderHealthService,
    PromptGeneratorService, // ADD
    CursorPromptBuilder, // ADD
    ClaudeCodePromptBuilder, // ADD
  ],
})
export class AiRoutingModule {}
