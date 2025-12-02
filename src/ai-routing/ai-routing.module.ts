import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { makeCounterProvider, makeHistogramProvider, makeGaugeProvider } from '@willsoto/nestjs-prometheus';
import { AIRoutingService } from './ai-routing.service';
import { ComplexityScorerService } from './complexity-scorer.service';
import { ProviderHealthService } from './provider-health.service';
import { AIRoutingConsumer } from './ai-routing.consumer';
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
    ],
    exports: [AIRoutingService, ComplexityScorerService, ProviderHealthService],
})
export class AiRoutingModule { }
