import { Test, TestingModule } from '@nestjs/testing';
import { FileLockManagerService } from './file-lock-manager.service';
import { PrismaService } from '@/database/prisma.service';
import { AIDecisionLoggerService } from '@/audit/ai-decision-logger.service';
import { MetricsService } from '@/common/metrics/metrics.service';
import { FilePredictionProvider } from './file-prediction.provider';

describe('FileLockManagerService', () => {
  let service: FileLockManagerService;
  let prismaService: { aIDecisionLog: { findFirst: jest.Mock } };
  let aiDecisionLogger: { logDecision: jest.Mock };
  let metricsService: { incrementCounter: jest.Mock; recordHistogram: jest.Mock; setGauge: jest.Mock };
  let filePredictionProvider: { predict: jest.Mock };

  beforeEach(async () => {
    prismaService = {
      aIDecisionLog: {
        findFirst: jest.fn(),
      },
    };

    aiDecisionLogger = {
      logDecision: jest.fn().mockResolvedValue({ id: 'log-id' }),
    };

    metricsService = {
      incrementCounter: jest.fn(),
      recordHistogram: jest.fn(),
      setGauge: jest.fn(),
    };

    filePredictionProvider = {
      predict: jest.fn(),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        FileLockManagerService,
        { provide: PrismaService, useValue: prismaService },
        { provide: AIDecisionLoggerService, useValue: aiDecisionLogger },
        { provide: MetricsService, useValue: metricsService },
        { provide: FilePredictionProvider, useValue: filePredictionProvider },
      ],
    }).compile();

    service = moduleRef.get(FileLockManagerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('predictFileModifications', () => {
    it('should return cached prediction when available', async () => {
      prismaService.aIDecisionLog.findFirst.mockResolvedValueOnce({
        timestamp: new Date(),
        output_data: {
          filePaths: ['src/auth/auth.service.ts'],
          confidence: 0.9,
          reasoning: 'cached',
        },
      });

      const result = await service.predictFileModifications({
        ticketId: 'ticket-123',
        executionId: 'exec-123',
        repoFullName: 'org/repo',
        ticketTitle: 'Auth change',
        ticketDescription: 'Update auth',
      });

      expect(result.filePaths).toEqual(['src/auth/auth.service.ts']);
      expect(filePredictionProvider.predict).not.toHaveBeenCalled();
    });

    it('should use explicit file paths from ticket text without calling AI', async () => {
      prismaService.aIDecisionLog.findFirst.mockResolvedValueOnce(null);

      const result = await service.predictFileModifications({
        ticketId: 'ticket-123',
        executionId: 'exec-123',
        repoFullName: 'org/repo',
        ticketTitle: 'Fix',
        ticketDescription: 'Please update src/auth/auth.service.ts and prisma/schema.prisma',
      });

      expect(result.filePaths).toEqual(expect.arrayContaining(['src/auth/auth.service.ts', 'prisma/schema.prisma']));
      expect(filePredictionProvider.predict).not.toHaveBeenCalled();
    });

    it('should call AI provider when no cache and no explicit paths', async () => {
      prismaService.aIDecisionLog.findFirst.mockResolvedValueOnce(null);
      filePredictionProvider.predict.mockResolvedValueOnce({
        filePaths: ['src/file-locks/file-lock-manager.service.ts'],
        confidence: 0.7,
        reasoning: 'ai',
      });

      const result = await service.predictFileModifications({
        ticketId: 'ticket-123',
        executionId: 'exec-123',
        repoFullName: 'org/repo',
        ticketTitle: 'Implement file locks',
        ticketDescription: 'Add file lock manager service',
      });

      expect(filePredictionProvider.predict).toHaveBeenCalledTimes(1);
      expect(result.filePaths).toEqual(['src/file-locks/file-lock-manager.service.ts']);
      expect(aiDecisionLogger.logDecision).toHaveBeenCalled();
    });
  });
});


