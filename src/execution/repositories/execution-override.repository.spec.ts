import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionOverrideRepository } from './execution-override.repository';
import { PrismaService } from '../../database/prisma.service';

describe('ExecutionOverrideRepository', () => {
  let repository: ExecutionOverrideRepository;
  let prismaService: jest.Mocked<PrismaService>;

  const mockOverride = {
    id: 'override-123',
    executionId: 'exec-456',
    userId: 'user-789',
    originalDecision: 'REJECT',
    newDecision: 'APPROVE',
    reason: 'False positive',
    overrideData: null,
    overriddenAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExecutionOverrideRepository,
        {
          provide: PrismaService,
          useValue: {
            executionOverride: {
              create: jest.fn().mockResolvedValue(mockOverride),
              findMany: jest.fn().mockResolvedValue([mockOverride]),
              findUnique: jest.fn().mockResolvedValue(mockOverride),
            },
          },
        },
      ],
    }).compile();

    repository = module.get<ExecutionOverrideRepository>(ExecutionOverrideRepository);
    prismaService = module.get(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create an execution override', async () => {
      const input = {
        executionId: 'exec-456',
        userId: 'user-789',
        originalDecision: 'REJECT',
        newDecision: 'APPROVE',
        reason: 'False positive',
        overrideData: { notes: 'Verified safe' },
      };

      const result = await repository.create(input);

      expect(result).toEqual(mockOverride);
      expect(prismaService.executionOverride.create).toHaveBeenCalledWith({
        data: {
          executionId: input.executionId,
          userId: input.userId,
          originalDecision: input.originalDecision,
          newDecision: input.newDecision,
          reason: input.reason,
          overrideData: input.overrideData,
        },
      });
    });

    it('should create override without original decision', async () => {
      const input = {
        executionId: 'exec-456',
        userId: 'user-789',
        newDecision: 'APPROVE',
        reason: 'Override reason',
      };

      await repository.create(input);

      expect(prismaService.executionOverride.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          executionId: input.executionId,
          originalDecision: null,
        }),
      });
    });
  });

  describe('findByExecutionId', () => {
    it('should find overrides by execution ID', async () => {
      const result = await repository.findByExecutionId('exec-456');

      expect(result).toEqual([mockOverride]);
      expect(prismaService.executionOverride.findMany).toHaveBeenCalledWith({
        where: { executionId: 'exec-456' },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              full_name: true,
            },
          },
        },
        orderBy: { overriddenAt: 'desc' },
      });
    });
  });

  describe('findByUserId', () => {
    it('should find overrides by user ID', async () => {
      const result = await repository.findByUserId('user-789');

      expect(result).toEqual([mockOverride]);
      expect(prismaService.executionOverride.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-789' },
        include: {
          execution: {
            select: {
              id: true,
              ticket_id: true,
              status: true,
            },
          },
        },
        orderBy: { overriddenAt: 'desc' },
      });
    });
  });

  describe('findById', () => {
    it('should find override by ID', async () => {
      const result = await repository.findById('override-123');

      expect(result).toEqual(mockOverride);
      expect(prismaService.executionOverride.findUnique).toHaveBeenCalledWith({
        where: { id: 'override-123' },
        include: {
          execution: {
            select: {
              id: true,
              ticket_id: true,
              status: true,
              ai_provider: true,
            },
          },
          user: {
            select: {
              id: true,
              email: true,
              full_name: true,
            },
          },
        },
      });
    });
  });

  describe('findMostRecentForExecution', () => {
    it('should return the most recent override', async () => {
      const mostRecent = { ...mockOverride, id: 'override-latest' };
      prismaService.executionOverride.findMany = jest.fn().mockResolvedValue([mostRecent]);

      const result = await repository.findMostRecentForExecution('exec-456');

      expect(result).toEqual(mostRecent);
      expect(prismaService.executionOverride.findMany).toHaveBeenCalledWith({
        where: { executionId: 'exec-456' },
        orderBy: { overriddenAt: 'desc' },
        take: 1,
      });
    });

    it('should return null when no overrides exist', async () => {
      prismaService.executionOverride.findMany = jest.fn().mockResolvedValue([]);

      const result = await repository.findMostRecentForExecution('exec-no-overrides');

      expect(result).toBeNull();
    });
  });
});
