/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test, TestingModule } from '@nestjs/testing';
import { PMFieldPreCheckService } from './pm-field-pre-check.service';
import { PMProviderFactory } from './providers/pm-provider.factory';
import { SentryService } from '@/common/sentry/sentry.service';
import { Logger } from '@nestjs/common';
import { NormalizedFieldType } from '@/integrations/providers/dto/normalized-field.dto';

describe('PMFieldPreCheckService', () => {
  let service: PMFieldPreCheckService;
  let providerFactory: jest.Mocked<PMProviderFactory>;
  let sentry: jest.Mocked<SentryService>;
  let mockProvider: any;

  const mockIntegration = { id: 'pi-1' } as any;
  const correlationId = 'corr-1';
  const taskId = 'task-1';
  const containerId = 'list-1';

  const requiredField = {
    id: 'f1',
    name: 'Required Field',
    type: NormalizedFieldType.TEXT,
    required: true,
  };

  beforeEach(async () => {
    mockProvider = {
      getRequiredFields: jest.fn(),
      getTask: jest.fn(),
    };

    const mockProviderFactory = {
      getProvider: jest.fn().mockResolvedValue(mockProvider),
    };

    const mockSentry = {
      captureException: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PMFieldPreCheckService,
        { provide: PMProviderFactory, useValue: mockProviderFactory },
        { provide: SentryService, useValue: mockSentry },
      ],
    }).compile();

    service = module.get<PMFieldPreCheckService>(PMFieldPreCheckService);
    providerFactory = module.get(PMProviderFactory);
    sentry = module.get(SentryService);

    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('checkRequiredFields', () => {
    // T1 -> AC5: allFilled: true, missingFields: [] when all required fields have values
    it('should return allFilled true when all fields present', async () => {
      mockProvider.getRequiredFields.mockResolvedValue([requiredField]);
      mockProvider.getTask.mockResolvedValue({
        customFields: { f1: 'some value' },
      });

      const result = await service.checkRequiredFields(
        mockIntegration,
        taskId,
        containerId,
        correlationId,
      );

      expect(result.allFilled).toBe(true);
      expect(result.missingFields).toHaveLength(0);
      expect(result.preCheckFailed).toBeUndefined();
    });

    // T2 -> AC4: missingFields includes field when value is null
    it('should include field in missingFields when value is null', async () => {
      mockProvider.getRequiredFields.mockResolvedValue([requiredField]);
      mockProvider.getTask.mockResolvedValue({
        customFields: { f1: null },
      });

      const result = await service.checkRequiredFields(
        mockIntegration,
        taskId,
        containerId,
        correlationId,
      );

      expect(result.allFilled).toBe(false);
      expect(result.missingFields).toContainEqual(requiredField);
    });

    // T3 -> AC4: missingFields includes field when value is undefined
    it('should include field in missingFields when value is undefined', async () => {
      mockProvider.getRequiredFields.mockResolvedValue([requiredField]);
      mockProvider.getTask.mockResolvedValue({
        customFields: { f1: undefined },
      });

      const result = await service.checkRequiredFields(
        mockIntegration,
        taskId,
        containerId,
        correlationId,
      );

      expect(result.allFilled).toBe(false);
      expect(result.missingFields).toContainEqual(requiredField);
    });

    // T4 -> AC4: missingFields includes field when value is ""
    it('should include field in missingFields when value is empty string', async () => {
      mockProvider.getRequiredFields.mockResolvedValue([requiredField]);
      mockProvider.getTask.mockResolvedValue({
        customFields: { f1: '' },
      });

      const result = await service.checkRequiredFields(
        mockIntegration,
        taskId,
        containerId,
        correlationId,
      );

      expect(result.allFilled).toBe(false);
      expect(result.missingFields).toContainEqual(requiredField);
    });

    // T5 -> AC4: missingFields includes field when value is []
    it('should include field in missingFields when value is empty array', async () => {
      const labelField = { ...requiredField, type: NormalizedFieldType.LABELS };
      mockProvider.getRequiredFields.mockResolvedValue([labelField]);
      mockProvider.getTask.mockResolvedValue({
        customFields: { f1: [] },
      });

      const result = await service.checkRequiredFields(
        mockIntegration,
        taskId,
        containerId,
        correlationId,
      );

      expect(result.allFilled).toBe(false);
      expect(result.missingFields).toContainEqual(labelField);
    });

    // T6 -> AC4: field NOT in missingFields when value is false
    it('should NOT include field in missingFields when value is false (valid checkbox)', async () => {
      const checkboxField = { ...requiredField, type: NormalizedFieldType.CHECKBOX };
      mockProvider.getRequiredFields.mockResolvedValue([checkboxField]);
      mockProvider.getTask.mockResolvedValue({
        customFields: { f1: false },
      });

      const result = await service.checkRequiredFields(
        mockIntegration,
        taskId,
        containerId,
        correlationId,
      );

      expect(result.allFilled).toBe(true);
      expect(result.missingFields).toHaveLength(0);
      expect(result.preCheckFailed).toBeUndefined();
    });

    // T7 -> AC4: field NOT in missingFields when value is 0
    it('should NOT include field in missingFields when value is 0 (valid number)', async () => {
      const numberField = { ...requiredField, type: NormalizedFieldType.NUMBER };
      mockProvider.getRequiredFields.mockResolvedValue([numberField]);
      mockProvider.getTask.mockResolvedValue({
        customFields: { f1: 0 },
      });

      const result = await service.checkRequiredFields(
        mockIntegration,
        taskId,
        containerId,
        correlationId,
      );

      expect(result.allFilled).toBe(true);
      expect(result.missingFields).toHaveLength(0);
      expect(result.preCheckFailed).toBeUndefined();
    });

    // T8 -> AC4: missingFields includes field when key is absent from customFields
    it('should include field in missingFields when key is absent', async () => {
      mockProvider.getRequiredFields.mockResolvedValue([requiredField]);
      mockProvider.getTask.mockResolvedValue({
        customFields: {},
      });

      const result = await service.checkRequiredFields(
        mockIntegration,
        taskId,
        containerId,
        correlationId,
      );

      expect(result.allFilled).toBe(false);
      expect(result.missingFields).toContainEqual(requiredField);
    });

    // T9 -> AC4: all fields missing when customFields is undefined
    it('should include all required fields when customFields is undefined', async () => {
      mockProvider.getRequiredFields.mockResolvedValue([requiredField]);
      mockProvider.getTask.mockResolvedValue({
        customFields: undefined,
      });

      const result = await service.checkRequiredFields(
        mockIntegration,
        taskId,
        containerId,
        correlationId,
      );

      expect(result.allFilled).toBe(false);
      expect(result.missingFields).toContainEqual(requiredField);
    });

    // T10 -> AC2: Promise.all called — both methods invoked in parallel
    it('should call provider methods in parallel via Promise.all', async () => {
      const allSpy = jest.spyOn(Promise, 'all');
      mockProvider.getRequiredFields.mockResolvedValue([]);
      mockProvider.getTask.mockResolvedValue({});

      await service.checkRequiredFields(mockIntegration, taskId, containerId, correlationId);

      expect(allSpy).toHaveBeenCalled();
      expect(mockProvider.getRequiredFields).toHaveBeenCalledWith(containerId);
      expect(mockProvider.getTask).toHaveBeenCalledWith(taskId);
    });

    // T11 -> AC6: fail-open when getRequiredFields() throws
    it('should fail open when getRequiredFields throws', async () => {
      mockProvider.getRequiredFields.mockRejectedValue(new Error('API Error'));
      mockProvider.getTask.mockResolvedValue({});

      const result = await service.checkRequiredFields(
        mockIntegration,
        taskId,
        containerId,
        correlationId,
      );

      expect(result).toEqual({
        missingFields: [],
        allFilled: true,
        preCheckFailed: true,
      });
      expect(sentry.captureException).toHaveBeenCalled();
    });

    // T12 -> AC6: fail-open when getTask() throws
    it('should fail open when getTask throws', async () => {
      mockProvider.getRequiredFields.mockResolvedValue([]);
      mockProvider.getTask.mockRejectedValue(new Error('API Error'));

      const result = await service.checkRequiredFields(
        mockIntegration,
        taskId,
        containerId,
        correlationId,
      );

      expect(result).toEqual({
        missingFields: [],
        allFilled: true,
        preCheckFailed: true,
      });
      expect(sentry.captureException).toHaveBeenCalled();
    });

    // T13 -> AC8: fail-open when containerId is empty
    it('should return fail-open if containerId is empty', async () => {
      const result = await service.checkRequiredFields(mockIntegration, taskId, '', correlationId);

      expect(result).toEqual({
        missingFields: [],
        allFilled: true,
        preCheckFailed: true,
      });
      expect(providerFactory.getProvider).not.toHaveBeenCalled();
    });
  });
});
