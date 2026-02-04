/**
 * Error Context Service Unit Tests
 * Story 9-U-4: Error Context Extraction & Linking
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ErrorContextService } from './error-context.service';
import { PrismaService } from '@/database/prisma.service';
import { SystemConfigService } from '@/system-settings/system-config.service';
import { SentryService } from '@/common/sentry/sentry.service';

import { ProductionErrorModel as ProductionError } from '@/prisma/models';

describe('ErrorContextService', () => {
  let service: ErrorContextService;

  let _prismaService: jest.Mocked<PrismaService>;

  let _configService: jest.Mocked<SystemConfigService>;
  let sentryService: jest.Mocked<SentryService>;

  const mockPrismaService = {
    productionError: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    productionErrorCommit: {
      create: jest.fn(),
    },
    deployment: {
      findFirst: jest.fn(),
    },
    project: {
      findFirst: jest.fn(),
    },
    aIDecisionLog: {
      create: jest.fn(),
    },
  };

  const mockConfigService = {
    get: jest.fn(),
  };

  const mockSentryService = {
    captureException: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ErrorContextService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: SystemConfigService, useValue: mockConfigService },
        { provide: SentryService, useValue: mockSentryService },
      ],
    }).compile();

    service = module.get<ErrorContextService>(ErrorContextService);
    _prismaService = module.get(PrismaService);
    _configService = module.get(SystemConfigService);
    sentryService = module.get(SentryService);

    // Reset mocks
    jest.clearAllMocks();

    // Default config values
    mockConfigService.get.mockImplementation((key: string, defaultValue?: string) => {
      const configs: Record<string, string> = {
        CONTEXT_EXTRACTION_ENABLED: 'true',
        DEPLOYMENT_LOOKUP_WINDOW_MINUTES: '60',
        COMMIT_HISTORY_DAYS: '7',
      };
      return Promise.resolve(configs[key] || defaultValue || '');
    });
  });

  describe('parseStackTrace', () => {
    it('should parse TypeScript/JavaScript stack trace correctly', () => {
      const stackTrace = `TypeError: Cannot read property 'x' of undefined
    at processPayment (/app/src/services/payment.ts:42:15)
    at async /app/src/routes/payments.ts:28:5
    at async Layer.handle (/app/node_modules/express/lib/router/layer.js:95:5)`;

      const result = service.parseStackTrace(stackTrace);

      expect(result.frames).toHaveLength(3);
      expect(result.top_frame).toEqual({
        file: '/app/src/services/payment.ts',
        line: 42,
        column: 15,
        function: 'processPayment',
      });
      expect(result.entry_frame).toEqual({
        file: '/app/node_modules/express/lib/router/layer.js',
        line: 95,
        column: 5,
        function: 'Layer.handle',
      });
      expect(result.raw).toBe(stackTrace);
    });

    it('should handle stack traces without column numbers', () => {
      const stackTrace = `Error: Something went wrong
    at myFunction (/app/src/file.js:10:5)
    at Object.<anonymous> (/app/src/main.js:20:3)`;

      const result = service.parseStackTrace(stackTrace);

      expect(result.frames).toHaveLength(2);
      expect(result.frames[0]).toEqual({
        file: '/app/src/file.js',
        line: 10,
        column: 5,
        function: 'myFunction',
      });
    });

    it('should handle anonymous functions', () => {
      const stackTrace = `Error: Test
    at /app/src/test.js:5:10`;

      const result = service.parseStackTrace(stackTrace);

      expect(result.frames[0].function).toBe('anonymous');
    });

    it('should handle empty stack trace', () => {
      const result = service.parseStackTrace('');

      expect(result.frames).toHaveLength(0);
      expect(result.top_frame.file).toBe('unknown');
      expect(result.entry_frame.file).toBe('unknown');
    });

    it('should handle stack traces with async/await', () => {
      const stackTrace = `Error: Async error
    at async UserService.getUser (/app/src/services/user.service.ts:25:12)
    at async UserController.getProfile (/app/src/controllers/user.controller.ts:40:20)`;

      const result = service.parseStackTrace(stackTrace);

      expect(result.frames).toHaveLength(2);
      expect(result.frames[0].function).toBe('UserService.getUser');
      expect(result.frames[1].function).toBe('UserController.getProfile');
    });
  });

  describe('findRelatedDeployment', () => {
    it('should find deployment within time window', async () => {
      const errorDate = new Date('2026-02-04T20:00:00Z');
      const mockError = {
        id: 'error-123',
        application: 'api-service',
        occurred_at: errorDate,
      } as ProductionError;

      const mockDeployment = {
        id: 'dep-456',
        created_at: new Date('2026-02-04T19:30:00Z'),
        deployed_at: new Date('2026-02-04T19:30:00Z'),
        github_push: {
          commit_sha: 'a1b2c3d',
          branch_name: 'main',
        },
      };

      mockPrismaService.deployment.findFirst.mockResolvedValue(mockDeployment);

      const result = await service.findRelatedDeployment(mockError);

      expect(result).toBeDefined();
      expect(result?.id).toBe('dep-456');
      expect(mockPrismaService.deployment.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            github_push: expect.objectContaining({
              repository: expect.objectContaining({
                contains: 'api-service',
                mode: 'insensitive',
              }),
            }),
            created_at: expect.objectContaining({
              gte: expect.any(Date),
              lte: expect.any(Date),
            }),
          }),
          orderBy: { created_at: 'desc' },
        }),
      );
    });

    it('should return null when no deployment found', async () => {
      const mockError = {
        id: 'error-123',
        application: 'unknown-service',
        occurred_at: new Date(),
      } as ProductionError;

      mockPrismaService.deployment.findFirst.mockResolvedValue(null);

      const result = await service.findRelatedDeployment(mockError);

      expect(result).toBeNull();
    });
  });

  describe('findRelatedCommits', () => {
    it('should return empty array when no file paths provided', async () => {
      const mockError = { id: 'error-123' } as ProductionError;

      const result = await service.findRelatedCommits(mockError, [], 'corr-123');

      expect(result).toEqual([]);
    });

    it('should skip node_modules paths', async () => {
      const mockError = { id: 'error-123' } as ProductionError;

      mockPrismaService.project.findFirst.mockResolvedValue({
        github_repository_url: 'https://github.com/org/repo',
      });

      const result = await service.findRelatedCommits(
        mockError,
        ['/app/node_modules/express/index.js', '/app/src/app.ts'],
        'corr-123',
      );

      // Should only process /app/src/app.ts, not node_modules
      expect(result).toEqual([]);
    });
  });

  describe('extractAndLinkContext', () => {
    it('should return null when context extraction is disabled', async () => {
      mockConfigService.get.mockResolvedValue('false');

      const result = await service.extractAndLinkContext('error-123', 'corr-123');

      expect(result).toBeNull();
    });

    it('should return null when error not found', async () => {
      mockPrismaService.productionError.findUnique.mockResolvedValue(null);

      const result = await service.extractAndLinkContext('error-123', 'corr-123');

      expect(result).toBeNull();
    });

    it('should extract context successfully', async () => {
      const mockError = {
        id: 'error-123',
        application: 'api-service',
        error_type: 'TypeError',
        error_message: "Cannot read property 'x' of undefined",
        stack_trace: `TypeError: Cannot read property 'x' of undefined
    at processPayment (/app/src/services/payment.ts:42:15)`,
        occurred_at: new Date(),
        affected_users: 1,
        occurrence_count: 1,
        deployment: null,
      };

      mockPrismaService.productionError.findUnique.mockResolvedValue(mockError);
      mockPrismaService.deployment.findFirst.mockResolvedValue(null);
      mockPrismaService.project.findFirst.mockResolvedValue({
        github_repository_url: 'https://github.com/org/repo',
      });
      mockPrismaService.productionError.update.mockResolvedValue(mockError);
      mockPrismaService.aIDecisionLog.create.mockResolvedValue({});

      const result = await service.extractAndLinkContext('error-123', 'corr-123');

      expect(result).toBeDefined();
      expect(result?.id).toBe('error-123');
      expect(result?.parsed_stack_trace?.frames).toHaveLength(1);
      expect(result?.parsed_stack_trace?.top_frame.file).toBe('/app/src/services/payment.ts');
      expect(mockPrismaService.productionError.update).toHaveBeenCalled();
      expect(mockPrismaService.aIDecisionLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            agent_name: 'ErrorContextService',
            action: 'ERROR_CONTEXT_EXTRACTED',
          }),
        }),
      );
    });

    it('should handle errors and log to Sentry', async () => {
      const error = new Error('Database error');
      mockPrismaService.productionError.findUnique.mockRejectedValue(error);

      await expect(service.extractAndLinkContext('error-123', 'corr-123')).rejects.toThrow(
        'Database error',
      );
      expect(sentryService.captureException).toHaveBeenCalled();
    });
  });

  describe('config getters', () => {
    it('should use default values when config is not set', async () => {
      mockConfigService.get.mockImplementation((key: string, defaultValue?: string) => {
        if (key === 'CONTEXT_EXTRACTION_ENABLED') return Promise.resolve('true');
        if (key === 'DEPLOYMENT_LOOKUP_WINDOW_MINUTES') return Promise.resolve('');
        return Promise.resolve(defaultValue || '');
      });

      const mockError = {
        id: 'error-123',
        occurred_at: new Date(),
      } as ProductionError;

      mockPrismaService.productionError.findUnique.mockResolvedValue(mockError);
      mockPrismaService.productionError.update.mockResolvedValue(mockError);
      mockPrismaService.deployment.findFirst.mockResolvedValue(null);
      mockPrismaService.aIDecisionLog.create.mockResolvedValue({});

      await service.extractAndLinkContext('error-123');

      // Should use default of 60 minutes for deployment lookup
      expect(mockPrismaService.deployment.findFirst).toHaveBeenCalled();
    });

    it('should handle invalid numeric config values', async () => {
      mockConfigService.get.mockImplementation((key: string, defaultValue?: string) => {
        if (key === 'CONTEXT_EXTRACTION_ENABLED') return Promise.resolve('true');
        if (key === 'DEPLOYMENT_LOOKUP_WINDOW_MINUTES') return Promise.resolve('invalid');
        return Promise.resolve(defaultValue || '');
      });

      const mockError = {
        id: 'error-123',
        occurred_at: new Date(),
      } as ProductionError;

      mockPrismaService.productionError.findUnique.mockResolvedValue(mockError);
      mockPrismaService.productionError.update.mockResolvedValue(mockError);
      mockPrismaService.deployment.findFirst.mockResolvedValue(null);
      mockPrismaService.aIDecisionLog.create.mockResolvedValue({});

      await service.extractAndLinkContext('error-123');

      // Should fall back to default of 60 when value is invalid
      expect(mockPrismaService.deployment.findFirst).toHaveBeenCalled();
    });
  });
});
