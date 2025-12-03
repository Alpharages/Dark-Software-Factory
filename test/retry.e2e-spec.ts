import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AIProvider, ExecutionStatus } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { RetryHandlerService } from '../src/execution/retry-handler.service';
import { RetryClassifierService } from '../src/execution/retry-classifier.service';
import { RetrySchedulerService } from '../src/execution/retry-scheduler.service';
import { PrismaService } from '../src/database/prisma.service';
import { ErrorSeverity } from '../src/execution/interfaces';

/**
 * Retry Logic Integration Tests
 * 
 * Tests the complete retry flow from failure to scheduling.
 * Run with: pnpm test:e2e -- --testPathPattern=retry
 */
describe('Retry Logic (e2e)', () => {
    let app: INestApplication;
    let retryHandler: RetryHandlerService;
    let classifier: RetryClassifierService;
    let scheduler: RetrySchedulerService;
    let prisma: PrismaService;

    beforeAll(async () => {
        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [AppModule],
        }).compile();

        app = moduleFixture.createNestApplication();
        await app.init();

        retryHandler = app.get<RetryHandlerService>(RetryHandlerService);
        classifier = app.get<RetryClassifierService>(RetryClassifierService);
        scheduler = app.get<RetrySchedulerService>(RetrySchedulerService);
        prisma = app.get<PrismaService>(PrismaService);
    });

    afterAll(async () => {
        await app.close();
    });

    describe('Error Classification', () => {
        it('should classify TIMEOUT as retryable', () => {
            const result = classifier.classifyError('TIMEOUT', 'Timed out', 'test-1');

            expect(result.isRetryable).toBe(true);
            expect(result.shouldFallback).toBe(true);
            expect(result.severity).toBe(ErrorSeverity.MEDIUM);
        });

        it('should classify RATE_LIMITED with longer delay', () => {
            const result = classifier.classifyError('RATE_LIMITED', 'Rate limited', 'test-2');

            expect(result.isRetryable).toBe(true);
            expect(result.suggestedDelayMs).toBeGreaterThan(10000);
        });

        it('should classify AUTHENTICATION_ERROR as non-retryable', () => {
            const result = classifier.classifyError('AUTHENTICATION_ERROR', 'Auth failed', 'test-3');

            expect(result.isRetryable).toBe(false);
            expect(result.severity).toBe(ErrorSeverity.CRITICAL);
        });

        it('should handle unknown errors gracefully', () => {
            const result = classifier.classifyError('CUSTOM_ERROR', 'Custom', 'test-4');

            expect(result.isRetryable).toBe(true); // Default to retryable
        });
    });

    describe('Retry Scheduling', () => {
        it('should calculate exponential backoff with jitter', () => {
            const delay0 = scheduler.calculateBackoffDelay(0);
            const delay1 = scheduler.calculateBackoffDelay(1);
            const delay2 = scheduler.calculateBackoffDelay(2);

            // With ±20% jitter:
            // Attempt 0: 800-1200ms
            // Attempt 1: 1600-2400ms  
            // Attempt 2: 3200-4800ms
            expect(delay0).toBeGreaterThanOrEqual(800);
            expect(delay0).toBeLessThanOrEqual(1200);

            expect(delay1).toBeGreaterThanOrEqual(1600);
            expect(delay1).toBeLessThanOrEqual(2400);

            expect(delay2).toBeGreaterThanOrEqual(3200);
            expect(delay2).toBeLessThanOrEqual(4800);
        });

        it('should cap delay at max delay (with jitter buffer)', () => {
            const delay10 = scheduler.calculateBackoffDelay(10);
            const config = scheduler.getRetryConfig();

            // Max with jitter = maxDelay * 1.2
            expect(delay10).toBeLessThanOrEqual(config.maxDelayMs * 1.2);
        });

        it('should not retry when max retries exceeded', () => {
            const decision = scheduler.shouldRetry(3, true, 'test-5');

            expect(decision.shouldRetry).toBe(false);
            expect(decision.reason).toBe('MAX_RETRIES_EXCEEDED');
        });

        it('should not retry non-retryable errors', () => {
            const decision = scheduler.shouldRetry(0, false, 'test-6');

            expect(decision.shouldRetry).toBe(false);
            expect(decision.reason).toBe('NON_RETRYABLE_ERROR');
        });
    });

    describe('Retry Metrics', () => {
        it('should track retry metrics', () => {
            const metrics = retryHandler.getMetrics();

            expect(metrics).toHaveProperty('totalRetries');
            expect(metrics).toHaveProperty('successfulRetries');
            expect(metrics).toHaveProperty('exhaustedRetries');
            expect(metrics).toHaveProperty('successRate');
            expect(metrics).toHaveProperty('retriesByErrorCode');
        });
    });
});
