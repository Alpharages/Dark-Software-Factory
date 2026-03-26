import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { AIProvider, ExecutionStatus } from '@/prisma/client';
import { AIExecutionPublisher } from './ai-execution.publisher';
import { ExecutionTrackerService } from './execution-tracker.service';
import { RabbitMQPublisherService } from '../rabbitmq/rabbitmq-publisher.service';
import { PublishExecutionDto } from './dto';

/**
 * AIExecutionPublisher Unit Tests
 * Story 2.10: RabbitMQ AI Execution Queue Processing
 */
describe('AIExecutionPublisher', () => {
  let publisher: AIExecutionPublisher;
  let executionTracker: jest.Mocked<ExecutionTrackerService>;
  let rabbitmqPublisher: jest.Mocked<RabbitMQPublisherService>;

  const mockExecution = {
    id: 'exec-123',
    ticket_id: 'ticket-456',
    ai_provider: AIProvider.CLAUDE_CODE,
    prompt: 'Test prompt',
    status: 'QUEUED',
    created_at: new Date(),
    updated_at: new Date(),
    // Story 23.2: Container cleanup tracking
    container_id: null,
    debug_mode: false,
  };

  beforeEach(async () => {
    const mockExecutionTracker = {
      startExecution: jest.fn().mockResolvedValue(mockExecution),
      failExecution: jest.fn().mockResolvedValue({}), // For rollback on publish failure
      findActiveExecution: jest.fn().mockResolvedValue(null), // Task 20-3: No active executions by default
    };

    const mockRabbitMQPublisher = {
      publishWithRetry: jest.fn().mockResolvedValue(true),
    };

    const mockCounter = { inc: jest.fn(), labels: jest.fn().mockReturnThis() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AIExecutionPublisher,
        { provide: ExecutionTrackerService, useValue: mockExecutionTracker },
        { provide: RabbitMQPublisherService, useValue: mockRabbitMQPublisher },
        { provide: 'PROM_METRIC_QUEUE_MESSAGES_PUBLISHED_TOTAL', useValue: mockCounter },
        { provide: 'PROM_METRIC_QUEUE_PUBLISH_ERRORS_TOTAL', useValue: mockCounter },
      ],
    }).compile();

    publisher = module.get<AIExecutionPublisher>(AIExecutionPublisher);
    executionTracker = module.get(ExecutionTrackerService);
    rabbitmqPublisher = module.get(RabbitMQPublisherService);
  });

  describe('publishExecution', () => {
    const validDto: PublishExecutionDto = {
      ticketId: 'ticket-456',
      prompt: 'Fix the bug in authentication',
      repositoryUrl: 'https://github.com/test/repo',
      projectId: 'proj-123',
      priority: 2,
    };

    it('should create execution and publish to queue', async () => {
      const result = await publisher.publishExecution(validDto);

      expect(result.executionId).toBe('exec-123');
      expect(result.correlationId).toBeDefined();
      expect(executionTracker.startExecution).toHaveBeenCalled();
      expect(rabbitmqPublisher.publishWithRetry).toHaveBeenCalled();
    });

    it('should use provided correlation ID', async () => {
      const correlationId = 'custom-corr-123';
      const result = await publisher.publishExecution(validDto, correlationId);

      expect(result.correlationId).toBe(correlationId);
    });

    it('should generate correlation ID if not provided', async () => {
      const result = await publisher.publishExecution(validDto);

      expect(result.correlationId).toBeDefined();
      expect(result.correlationId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    });

    it('should use CLAUDE_CODE as default provider', async () => {
      await publisher.publishExecution(validDto);

      const callArg = executionTracker.startExecution.mock.calls[0][0];
      expect(callArg.provider).toBe(AIProvider.CLAUDE_CODE);
    });

    it('should use preferred provider when specified', async () => {
      const dtoWithProvider = {
        ...validDto,
        preferredProvider: AIProvider.CLAUDE_CODE,
      };

      await publisher.publishExecution(dtoWithProvider);

      const callArg = executionTracker.startExecution.mock.calls[0][0];
      expect(callArg.provider).toBe(AIProvider.CLAUDE_CODE);
    });

    it('should use default priority of 3 when not specified', async () => {
      const dtoNoPriority = { ...validDto };

      delete (dtoNoPriority as any).priority;

      await publisher.publishExecution(dtoNoPriority);

      // Check the message published to RabbitMQ
      const publishCall = rabbitmqPublisher.publishWithRetry.mock.calls[0];
      const message = publishCall[1] as { payload: { priority: number } };
      expect(message.payload.priority).toBe(3);
    });

    it('should throw and track error when publish fails', async () => {
      rabbitmqPublisher.publishWithRetry.mockResolvedValue(false);

      await expect(publisher.publishExecution(validDto)).rejects.toThrow(
        'Failed to publish message to queue',
      );
    });

    it('should rollback execution status when publish fails', async () => {
      rabbitmqPublisher.publishWithRetry.mockResolvedValue(false);

      await expect(publisher.publishExecution(validDto)).rejects.toThrow();

      // Verify rollback was called
      expect(executionTracker.failExecution).toHaveBeenCalledWith(
        expect.objectContaining({
          executionId: 'exec-123',
          errorCode: 'QUEUE_PUBLISH_FAILED',
          isRetryable: true,
        }),
        expect.any(String), // correlationId
      );
    });

    it('should calculate complexity score from priority', async () => {
      // Priority 1 (highest) should map to higher complexity
      const highPriorityDto = { ...validDto, priority: 1 };
      await publisher.publishExecution(highPriorityDto);

      const callArg = executionTracker.startExecution.mock.calls[0][0];
      // Complexity = (6 - priority) * 2 = (6-1) * 2 = 10
      expect(callArg.complexityScore).toBe(10);
    });

    // Task 20-3: Duplicate execution prevention tests
    describe('duplicate prevention', () => {
      it('should throw ConflictException when active execution exists (QUEUED)', async () => {
        executionTracker.findActiveExecution = jest.fn().mockResolvedValue({
          id: 'existing-exec',
          ticket_id: validDto.ticketId,
          status: ExecutionStatus.QUEUED,
          created_at: new Date(),
        });

        await expect(publisher.publishExecution(validDto)).rejects.toThrow(ConflictException);
        expect(executionTracker.startExecution).not.toHaveBeenCalled();
      });

      it('should throw ConflictException when active execution exists (IN_PROGRESS)', async () => {
        executionTracker.findActiveExecution = jest.fn().mockResolvedValue({
          id: 'existing-exec',
          ticket_id: validDto.ticketId,
          status: ExecutionStatus.IN_PROGRESS,
          created_at: new Date(),
        });

        await expect(publisher.publishExecution(validDto)).rejects.toThrow(ConflictException);
        expect(executionTracker.startExecution).not.toHaveBeenCalled();
      });

      it('should throw ConflictException when active execution exists (AWAITING_APPROVAL)', async () => {
        executionTracker.findActiveExecution = jest.fn().mockResolvedValue({
          id: 'existing-exec',
          ticket_id: validDto.ticketId,
          status: ExecutionStatus.AWAITING_APPROVAL,
          created_at: new Date(),
        });

        await expect(publisher.publishExecution(validDto)).rejects.toThrow(ConflictException);
        expect(executionTracker.startExecution).not.toHaveBeenCalled();
      });

      it('should allow new execution when previous is COMPLETED', async () => {
        // No active execution (findActiveExecution returns null)
        executionTracker.findActiveExecution = jest.fn().mockResolvedValue(null);

        const result = await publisher.publishExecution(validDto);

        expect(result.executionId).toBe('exec-123');
        expect(executionTracker.startExecution).toHaveBeenCalled();
      });

      it('should allow new execution when previous is FAILED', async () => {
        // No active execution (findActiveExecution returns null)
        executionTracker.findActiveExecution = jest.fn().mockResolvedValue(null);

        const result = await publisher.publishExecution(validDto);

        expect(result.executionId).toBe('exec-123');
        expect(executionTracker.startExecution).toHaveBeenCalled();
      });

      it('should allow new execution when force=true even with active execution', async () => {
        executionTracker.findActiveExecution = jest.fn().mockResolvedValue({
          id: 'existing-exec',
          ticket_id: validDto.ticketId,
          status: ExecutionStatus.QUEUED,
          created_at: new Date(),
        });

        const dtoWithForce = { ...validDto, force: true };
        const result = await publisher.publishExecution(dtoWithForce);

        expect(result.executionId).toBe('exec-123');
        expect(executionTracker.startExecution).toHaveBeenCalled();
      });

      it('should include existing execution info in error message', async () => {
        executionTracker.findActiveExecution = jest.fn().mockResolvedValue({
          id: 'existing-exec-123',
          ticket_id: validDto.ticketId,
          status: ExecutionStatus.IN_PROGRESS,
          created_at: new Date(),
        });

        await expect(publisher.publishExecution(validDto)).rejects.toThrow('existing-exec-123');
      });
    });
  });

  describe('publishBatch', () => {
    const batchDtos: PublishExecutionDto[] = [
      {
        ticketId: 'ticket-1',
        prompt: 'Task 1',
        repositoryUrl: 'https://github.com/test/repo',
        projectId: 'proj-123',
      },
      {
        ticketId: 'ticket-2',
        prompt: 'Task 2',
        repositoryUrl: 'https://github.com/test/repo',
        projectId: 'proj-123',
      },
    ];

    it('should publish multiple executions', async () => {
      const result = await publisher.publishBatch(batchDtos);

      expect(result.executionIds).toHaveLength(2);
      expect(executionTracker.startExecution).toHaveBeenCalledTimes(2);
      expect(rabbitmqPublisher.publishWithRetry).toHaveBeenCalledTimes(2);
    });

    it('should use same correlation ID for all batch items', async () => {
      const correlationId = 'batch-corr-123';
      const result = await publisher.publishBatch(batchDtos, correlationId);

      expect(result.correlationId).toBe(correlationId);
    });
  });
});
