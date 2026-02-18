import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionRepository } from './execution.repository';
import { PrismaService } from '../database/prisma.service';
import { ExecutionStatus, AIProvider } from '@/prisma/client';
import { IExecutionAuditLog } from './interfaces';

describe('ExecutionRepository', () => {
  let repository: ExecutionRepository;
  let prisma: jest.Mocked<PrismaService>;

  const mockExecution = {
    id: 'exec-123',
    ticket_id: 'ticket-123',
    ai_provider: AIProvider.CURSOR_HEADLESS,
    prompt: 'test prompt',
    status: ExecutionStatus.QUEUED,
    confidence_score: null,
    started_at: null,
    completed_at: null,
    failed_at: null,
    error_message: null,
    code_output: null,
    files_changed: null,
    retry_count: 0,
    max_retries: 3,
    created_at: new Date(),
    updated_at: new Date(),
    complexity_score: 50,
    complexity_breakdown: null,
    routing_reason: null,
    fallback_used: false,
    original_provider: null,
    // Story 23.2: Container cleanup tracking
    container_id: null,
    debug_mode: false,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExecutionRepository,
        {
          provide: PrismaService,
          useValue: {
            execution: {
              create: jest.fn(),
              findUnique: jest.fn(),
              findMany: jest.fn(),
              findFirst: jest.fn(),
              update: jest.fn(),
              groupBy: jest.fn(),
              count: jest.fn(),
            },
            ticket: {
              update: jest.fn(),
            },
            auditLog: {
              create: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    repository = module.get<ExecutionRepository>(ExecutionRepository);
    prisma = module.get(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(repository).toBeDefined();
  });

  describe('create', () => {
    it('should create execution with all fields', async () => {
      (prisma.execution.create as jest.Mock).mockResolvedValue(mockExecution);

      const result = await repository.create({
        ticketId: 'ticket-123',
        provider: AIProvider.CURSOR_HEADLESS,
        prompt: 'test prompt',
        status: ExecutionStatus.QUEUED,
        maxRetries: 3,
        complexityScore: 50,
      });

      expect(result).toEqual(mockExecution);
      expect(prisma.execution.create).toHaveBeenCalledWith({
        data: {
          ticket_id: 'ticket-123',
          ai_provider: AIProvider.CURSOR_HEADLESS,
          prompt: 'test prompt',
          status: ExecutionStatus.QUEUED,
          max_retries: 3,
          retry_count: 0,
          complexity_score: 50,
        },
        include: {
          ticket: {
            select: {
              project_id: true,
            },
          },
        },
      });
    });

    it('should use default values when optional fields not provided', async () => {
      (prisma.execution.create as jest.Mock).mockResolvedValue(mockExecution);

      await repository.create({
        ticketId: 'ticket-123',
        provider: AIProvider.CLAUDE_CODE,
        prompt: 'test prompt',
      });

      expect(prisma.execution.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: ExecutionStatus.QUEUED,
          max_retries: 3,
          retry_count: 0,
        }),
        include: {
          ticket: {
            select: {
              project_id: true,
            },
          },
        },
      });
    });
  });

  describe('findById', () => {
    it('should find execution by ID', async () => {
      (prisma.execution.findUnique as jest.Mock).mockResolvedValue(mockExecution);

      const result = await repository.findById('exec-123');

      expect(result).toEqual(mockExecution);
      expect(prisma.execution.findUnique).toHaveBeenCalledWith({
        where: { id: 'exec-123' },
        include: {
          ticket: {
            select: {
              project_id: true,
            },
          },
        },
      });
    });

    it('should return null if not found', async () => {
      (prisma.execution.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await repository.findById('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('findByTicketId', () => {
    it('should find executions by ticket ID', async () => {
      (prisma.execution.findMany as jest.Mock).mockResolvedValue([mockExecution]);

      const result = await repository.findByTicketId('ticket-123');

      expect(result).toEqual([mockExecution]);
      expect(prisma.execution.findMany).toHaveBeenCalledWith({
        where: { ticket_id: 'ticket-123' },
        orderBy: { created_at: 'desc' },
      });
    });
  });

  describe('updateStatus', () => {
    it('should update to IN_PROGRESS and set started_at', async () => {
      (prisma.execution.update as jest.Mock).mockResolvedValue({
        ...mockExecution,
        status: ExecutionStatus.IN_PROGRESS,
        started_at: new Date(),
      });

      await repository.updateStatus('exec-123', ExecutionStatus.IN_PROGRESS);

      expect(prisma.execution.update).toHaveBeenCalledWith({
        where: { id: 'exec-123' },
        data: expect.objectContaining({
          status: ExecutionStatus.IN_PROGRESS,
          started_at: expect.any(Date),
        }),
      });
    });

    it('should update to COMPLETED with additional data', async () => {
      (prisma.execution.update as jest.Mock).mockResolvedValue({
        ...mockExecution,
        status: ExecutionStatus.COMPLETED,
        completed_at: new Date(),
        confidence_score: 0.95,
      });

      await repository.updateStatus('exec-123', ExecutionStatus.COMPLETED, {
        confidenceScore: 0.95,
        codeOutput: '// code',
        filesChanged: ['file.ts'],
      });

      expect(prisma.execution.update).toHaveBeenCalledWith({
        where: { id: 'exec-123' },
        data: expect.objectContaining({
          status: ExecutionStatus.COMPLETED,
          completed_at: expect.any(Date),
          confidence_score: 0.95,
          code_output: '// code',
          files_changed: ['file.ts'],
        }),
      });
    });

    it('should update to FAILED and set failed_at', async () => {
      (prisma.execution.update as jest.Mock).mockResolvedValue({
        ...mockExecution,
        status: ExecutionStatus.FAILED,
        failed_at: new Date(),
      });

      await repository.updateStatus('exec-123', ExecutionStatus.FAILED, {
        errorMessage: 'Something went wrong',
      });

      expect(prisma.execution.update).toHaveBeenCalledWith({
        where: { id: 'exec-123' },
        data: expect.objectContaining({
          status: ExecutionStatus.FAILED,
          failed_at: expect.any(Date),
          error_message: 'Something went wrong',
        }),
      });
    });

    it('should update to TIMEOUT and set failed_at', async () => {
      (prisma.execution.update as jest.Mock).mockResolvedValue({
        ...mockExecution,
        status: ExecutionStatus.TIMEOUT,
        failed_at: new Date(),
      });

      await repository.updateStatus('exec-123', ExecutionStatus.TIMEOUT, {
        errorMessage: 'Timed out after 300s',
      });

      expect(prisma.execution.update).toHaveBeenCalledWith({
        where: { id: 'exec-123' },
        data: expect.objectContaining({
          status: ExecutionStatus.TIMEOUT,
          failed_at: expect.any(Date),
        }),
      });
    });
  });

  describe('incrementRetryAndRequeue', () => {
    it('should increment retry count and reset to QUEUED', async () => {
      (prisma.execution.update as jest.Mock).mockResolvedValue({
        ...mockExecution,
        status: ExecutionStatus.QUEUED,
        retry_count: 1,
      });

      const result = await repository.incrementRetryAndRequeue('exec-123');

      expect(result.retry_count).toBe(1);
      expect(prisma.execution.update).toHaveBeenCalledWith({
        where: { id: 'exec-123' },
        data: {
          retry_count: { increment: 1 },
          status: ExecutionStatus.QUEUED,
          failed_at: null,
          error_message: null,
        },
      });
    });
  });

  describe('canRetry', () => {
    it('should return true if retry count is below max', async () => {
      (prisma.execution.findUnique as jest.Mock).mockResolvedValue({
        retry_count: 1,
        max_retries: 3,
        status: ExecutionStatus.FAILED,
      });

      const result = await repository.canRetry('exec-123');

      expect(result).toEqual({
        canRetry: true,
        retryCount: 1,
        maxRetries: 3,
      });
    });

    it('should return false if retry count equals max', async () => {
      (prisma.execution.findUnique as jest.Mock).mockResolvedValue({
        retry_count: 3,
        max_retries: 3,
        status: ExecutionStatus.FAILED,
      });

      const result = await repository.canRetry('exec-123');

      expect(result).toEqual({
        canRetry: false,
        retryCount: 3,
        maxRetries: 3,
      });
    });

    it('should return false if execution not found', async () => {
      (prisma.execution.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await repository.canRetry('non-existent');

      expect(result).toEqual({
        canRetry: false,
        retryCount: 0,
        maxRetries: 0,
      });
    });
  });

  describe('findByStatus', () => {
    it('should find executions by status', async () => {
      (prisma.execution.findMany as jest.Mock).mockResolvedValue([mockExecution]);

      const result = await repository.findByStatus(ExecutionStatus.QUEUED);

      expect(result).toEqual([mockExecution]);
      expect(prisma.execution.findMany).toHaveBeenCalledWith({
        where: { status: ExecutionStatus.QUEUED },
        take: undefined,
        orderBy: { created_at: 'asc' },
      });
    });

    it('should filter by provider if provided', async () => {
      (prisma.execution.findMany as jest.Mock).mockResolvedValue([mockExecution]);

      await repository.findByStatus(ExecutionStatus.IN_PROGRESS, {
        provider: AIProvider.CURSOR_HEADLESS,
        limit: 10,
      });

      expect(prisma.execution.findMany).toHaveBeenCalledWith({
        where: {
          status: ExecutionStatus.IN_PROGRESS,
          ai_provider: AIProvider.CURSOR_HEADLESS,
        },
        take: 10,
        orderBy: { created_at: 'asc' },
      });
    });
  });

  describe('getActiveCountByProvider', () => {
    it('should return active count per provider', async () => {
      (prisma.execution.groupBy as jest.Mock).mockResolvedValue([
        { ai_provider: AIProvider.CURSOR_HEADLESS, _count: 5 },
        { ai_provider: AIProvider.CLAUDE_CODE, _count: 3 },
      ]);

      const result = await repository.getActiveCountByProvider();

      expect(result).toEqual({
        [AIProvider.CURSOR_HEADLESS]: 5,
        [AIProvider.CLAUDE_CODE]: 3,
      });
    });

    it('should return zeros if no active executions', async () => {
      (prisma.execution.groupBy as jest.Mock).mockResolvedValue([]);

      const result = await repository.getActiveCountByProvider();

      expect(result).toEqual({
        [AIProvider.CURSOR_HEADLESS]: 0,
        [AIProvider.CLAUDE_CODE]: 0,
      });
    });
  });

  describe('createAuditLog', () => {
    it('should create audit log entry', async () => {
      (prisma.auditLog.create as jest.Mock).mockResolvedValue({});

      const log: IExecutionAuditLog = {
        entityType: 'execution',
        entityId: 'exec-123',
        action: 'created',
        actorType: 'system',
        actorId: null,
        beforeState: null,
        afterState: { status: 'QUEUED' },
        createdAt: new Date(),
      };

      await repository.createAuditLog(log);

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          entity_type: 'execution',
          entity_id: 'exec-123',
          action: 'created',
          actor_type: 'system',
          actor_id: null,
        }),
      });
    });
  });

  describe('updateTicketStatus', () => {
    it('should update ticket to AI_PROCESSING for IN_PROGRESS', async () => {
      (prisma.ticket.update as jest.Mock).mockResolvedValue({});

      await repository.updateTicketStatus('ticket-123', 'IN_PROGRESS');

      expect(prisma.ticket.update).toHaveBeenCalledWith({
        where: { id: 'ticket-123' },
        data: { status: 'AI_PROCESSING' },
      });
    });

    it('should update ticket to QA_REVIEW for COMPLETED', async () => {
      (prisma.ticket.update as jest.Mock).mockResolvedValue({});

      await repository.updateTicketStatus('ticket-123', 'COMPLETED');

      expect(prisma.ticket.update).toHaveBeenCalledWith({
        where: { id: 'ticket-123' },
        data: { status: 'QA_REVIEW' },
      });
    });

    it('should update ticket to FAILED for CANCELLED', async () => {
      (prisma.ticket.update as jest.Mock).mockResolvedValue({});

      await repository.updateTicketStatus('ticket-123', 'CANCELLED');

      expect(prisma.ticket.update).toHaveBeenCalledWith({
        where: { id: 'ticket-123' },
        data: { status: 'FAILED' },
      });
    });

    it('should not update ticket for unmapped status', async () => {
      await repository.updateTicketStatus('ticket-123', 'UNKNOWN_STATUS');

      expect(prisma.ticket.update).not.toHaveBeenCalled();
    });
  });

  // Task 20-3: Duplicate execution prevention tests
  describe('findActiveExecutionByTicketId', () => {
    it('should return active execution for ticket', async () => {
      (prisma.execution.findFirst as jest.Mock).mockResolvedValue({
        ...mockExecution,
        status: ExecutionStatus.IN_PROGRESS,
      });

      const result = await repository.findActiveExecutionByTicketId('ticket-123');

      expect(result).toBeDefined();
      expect(result?.status).toBe(ExecutionStatus.IN_PROGRESS);
      expect(prisma.execution.findFirst).toHaveBeenCalledWith({
        where: {
          ticket_id: 'ticket-123',
          status: {
            in: [
              ExecutionStatus.QUEUED,
              ExecutionStatus.IN_PROGRESS,
              ExecutionStatus.AWAITING_APPROVAL,
            ],
          },
        },
        orderBy: { created_at: 'desc' },
      });
    });

    it('should return null if no active execution', async () => {
      (prisma.execution.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await repository.findActiveExecutionByTicketId('ticket-123');

      expect(result).toBeNull();
    });

    it('should return most recent active execution', async () => {
      const recentExecution = {
        ...mockExecution,
        id: 'exec-recent',
        status: ExecutionStatus.QUEUED,
        created_at: new Date(Date.now() - 1000),
      };
      (prisma.execution.findFirst as jest.Mock).mockResolvedValue(recentExecution);

      const result = await repository.findActiveExecutionByTicketId('ticket-123');

      expect(result?.id).toBe('exec-recent');
    });
  });

  describe('hasActiveExecution', () => {
    it('should return true when active execution exists', async () => {
      (prisma.execution.count as jest.Mock).mockResolvedValue(1);

      const result = await repository.hasActiveExecution('ticket-123');

      expect(result).toBe(true);
      expect(prisma.execution.count).toHaveBeenCalledWith({
        where: {
          ticket_id: 'ticket-123',
          status: {
            in: [
              ExecutionStatus.QUEUED,
              ExecutionStatus.IN_PROGRESS,
              ExecutionStatus.AWAITING_APPROVAL,
            ],
          },
        },
      });
    });

    it('should return false when no active execution', async () => {
      (prisma.execution.count as jest.Mock).mockResolvedValue(0);

      const result = await repository.hasActiveExecution('ticket-123');

      expect(result).toBe(false);
    });
  });
});
