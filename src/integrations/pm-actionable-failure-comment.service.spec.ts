import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { ProjectIntegration } from '@/prisma/client';
import { PMProviderFactory } from '@/integrations/providers/pm-provider.factory';
import { SentryService } from '@/common/sentry/sentry.service';
import {
  PMActionableFailureCommentService,
  ActionableFailureContext,
} from '@/integrations/pm-actionable-failure-comment.service';
import { NormalizedFieldType } from '@/integrations/providers/dto/normalized-field.dto';

describe('PMActionableFailureCommentService', () => {
  let service: PMActionableFailureCommentService;
  let providerFactory: PMProviderFactory;
  let sentryService: SentryService;

  let mockProvider: any;

  const mockIntegration = { id: 'int-001', provider: 'CLICKUP' } as unknown as ProjectIntegration;
  const correlationId = 'test-correlation-id';
  const taskId = 'task-123';

  beforeEach(async () => {
    mockProvider = {
      addComment: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PMActionableFailureCommentService,
        {
          provide: PMProviderFactory,
          useValue: {
            getProvider: jest.fn().mockResolvedValue(mockProvider),
          },
        },
        {
          provide: SentryService,
          useValue: {
            captureException: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<PMActionableFailureCommentService>(PMActionableFailureCommentService);
    providerFactory = module.get<PMProviderFactory>(PMProviderFactory);
    sentryService = module.get<SentryService>(SentryService);

    // Disable logger output for tests
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('postActionableFailureComment', () => {
    it('T-AF1: null integration → returns immediately, provider.addComment() never called', async () => {
      await service.postActionableFailureComment(
        null,
        taskId,
        { targetStatus: 'Deployed', failureReason: 'Test' },
        correlationId,
      );
      expect(providerFactory.getProvider).not.toHaveBeenCalled();
      expect(mockProvider.addComment).not.toHaveBeenCalled();
    });

    it('T-AF2: Successful comment: provider.addComment() called with correctly formatted text', async () => {
      const context: ActionableFailureContext = {
        targetStatus: 'Deployed',
        failureReason: 'ClickUp status update returned false',
      };

      await service.postActionableFailureComment(mockIntegration, taskId, context, correlationId);

      expect(providerFactory.getProvider).toHaveBeenCalledWith(mockIntegration);
      expect(mockProvider.addComment).toHaveBeenCalledWith(
        taskId,
        expect.stringContaining('🚨 DSF Sync Failure — Action Required'),
      );
    });

    it('T-AF3: Comment body contains targetStatus value', async () => {
      const context: ActionableFailureContext = {
        targetStatus: 'Deployed Status ABC',
        failureReason: 'Test failure',
      };

      await service.postActionableFailureComment(mockIntegration, taskId, context, correlationId);
      expect(mockProvider.addComment).toHaveBeenCalledWith(
        taskId,
        expect.stringContaining('**Target Status:** Deployed Status ABC'),
      );
      expect(mockProvider.addComment).toHaveBeenCalledWith(
        taskId,
        expect.stringContaining('2. Manually update the status to: Deployed Status ABC'),
      );
    });

    it('T-AF4: Comment body contains failureReason value', async () => {
      const context: ActionableFailureContext = {
        targetStatus: 'Deployed',
        failureReason: 'Critical provider error XYZ',
      };

      await service.postActionableFailureComment(mockIntegration, taskId, context, correlationId);
      expect(mockProvider.addComment).toHaveBeenCalledWith(
        taskId,
        expect.stringContaining('**Failure Reason:** Critical provider error XYZ'),
      );
    });

    it('T-AF5: Comment includes **Provider Error Code:** line when providerErrorCode is truthy', async () => {
      const context: ActionableFailureContext = {
        targetStatus: 'Deployed',
        failureReason: 'Test',
        providerErrorCode: 'OAUTH_017',
      };

      await service.postActionableFailureComment(mockIntegration, taskId, context, correlationId);
      expect(mockProvider.addComment).toHaveBeenCalledWith(
        taskId,
        expect.stringContaining('**Provider Error Code:** OAUTH_017'),
      );
    });

    it('T-AF6: Comment does NOT include **Provider Error Code:** line when providerErrorCode is undefined', async () => {
      const context: ActionableFailureContext = {
        targetStatus: 'Deployed',
        failureReason: 'Test',
      };

      await service.postActionableFailureComment(mockIntegration, taskId, context, correlationId);
      expect(mockProvider.addComment).toHaveBeenCalledWith(
        taskId,
        expect.not.stringContaining('**Provider Error Code:**'),
      );
    });

    it('T-AF7: Comment includes **Provider Message:** line with verbatim err from providerErrorBody', async () => {
      const context: ActionableFailureContext = {
        targetStatus: 'Deployed',
        failureReason: 'Test',
        providerErrorBody: { err: 'Token not found', ECODE: 'OAUTH_017' },
      };

      await service.postActionableFailureComment(mockIntegration, taskId, context, correlationId);
      expect(mockProvider.addComment).toHaveBeenCalledWith(
        taskId,
        expect.stringContaining('**Provider Message:** "Token not found"'),
      );
    });

    it('T-AF8: Comment includes manual step 3 with field names when missingFields is non-empty', async () => {
      const context: ActionableFailureContext = {
        targetStatus: 'Deployed',
        failureReason: 'Test',
        missingFields: [
          { id: 'f1', name: 'Estimated Time', type: NormalizedFieldType.NUMBER, required: true },
          { id: 'f2', name: 'PR Link', type: NormalizedFieldType.URL, required: true },
        ],
      };

      await service.postActionableFailureComment(mockIntegration, taskId, context, correlationId);
      expect(mockProvider.addComment).toHaveBeenCalledWith(
        taskId,
        expect.stringContaining('3. Fill in the following required fields:'),
      );
      expect(mockProvider.addComment).toHaveBeenCalledWith(
        taskId,
        expect.stringContaining('• Estimated Time (type: number)'),
      );
      expect(mockProvider.addComment).toHaveBeenCalledWith(
        taskId,
        expect.stringContaining('• PR Link (type: url)'),
      );
    });

    it('T-AF9: Comment does NOT include step 3 when missingFields is empty', async () => {
      const context: ActionableFailureContext = {
        targetStatus: 'Deployed',
        failureReason: 'Test',
        missingFields: [],
      };

      await service.postActionableFailureComment(mockIntegration, taskId, context, correlationId);
      expect(mockProvider.addComment).toHaveBeenCalledWith(
        taskId,
        expect.not.stringContaining('3. Fill in the following required fields:'),
      );
    });

    it('T-AF10: addComment() throws → error caught, Sentry notified, no throw from service', async () => {
      mockProvider.addComment.mockRejectedValue(new Error('Network error'));

      const context: ActionableFailureContext = { targetStatus: 'D', failureReason: 'F' };

      await expect(
        service.postActionableFailureComment(mockIntegration, taskId, context, correlationId),
      ).resolves.not.toThrow();

      expect(sentryService.captureException).toHaveBeenCalledWith(expect.any(Error));
    });

    it('T-AF11: providerFactory.getProvider() throws → error caught, Sentry notified, no throw', async () => {
      (providerFactory.getProvider as jest.Mock).mockRejectedValue(new Error('Factory error'));

      const context: ActionableFailureContext = { targetStatus: 'D', failureReason: 'F' };

      await expect(
        service.postActionableFailureComment(mockIntegration, taskId, context, correlationId),
      ).resolves.not.toThrow();

      expect(sentryService.captureException).toHaveBeenCalledWith(expect.any(Error));
    });
  });
});
