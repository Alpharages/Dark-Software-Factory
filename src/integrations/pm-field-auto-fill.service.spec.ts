/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { PMFieldAutoFillService, ExecutionContext } from './pm-field-auto-fill.service';
import { PMProviderFactory } from './providers/pm-provider.factory';
import { SentryService } from '@/common/sentry/sentry.service';
import { IPMProvider } from './providers/pm-provider.interface';
import { NormalizedField, NormalizedFieldType } from './providers/dto/normalized-field.dto';
import { ProjectIntegration, IntegrationProvider } from '@prisma/client';

describe('PMFieldAutoFillService', () => {
  let service: PMFieldAutoFillService;
  let providerFactory: jest.Mocked<PMProviderFactory>;
  let provider: jest.Mocked<IPMProvider>;
  let sentry: jest.Mocked<SentryService>;

  const mockIntegration: ProjectIntegration = {
    id: 'int-123',
    project_id: 'proj-123',
    provider: IntegrationProvider.CLICKUP,
    workspace_id: 'ws-123',
    workspace_name: 'WS',
    access_token: 'token',
    refresh_token: null,
    token_expiry: null,
    bot_user_id: 'bot-123',
    bot_username: 'bot',
    webhook_secret: null,
    webhook_id: null,
    provider_config: {},
    polling_enabled: true,
    webhook_enabled: true,
    polling_interval_min: 5,
    polling_last_run_at: null,
    ai_trigger_status: 'AI_TRIGGERED',
    created_at: new Date(),
    updated_at: new Date(),
  };

  const mockCtx: ExecutionContext = {
    executionDurationMinutes: 45,
    deployedAt: new Date('2024-03-20T10:00:00Z'),
    prUrl: 'https://github.com/org/repo/pull/1',
    branchName: 'feature/test',
  };

  beforeEach(async () => {
    provider = {
      setFieldValue: jest.fn().mockResolvedValue(undefined),
    } as any;

    providerFactory = {
      getProvider: jest.fn().mockResolvedValue(provider),
    } as any;

    sentry = {
      captureException: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PMFieldAutoFillService,
        { provide: PMProviderFactory, useValue: providerFactory },
        { provide: SentryService, useValue: sentry },
      ],
    }).compile();

    service = module.get<PMFieldAutoFillService>(PMFieldAutoFillService);
    // Disable logging for tests
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });

  it('should return empty result if no missing fields (AC11)', async () => {
    const result = await service.fillFactualFields(mockIntegration, 'taskId', [], mockCtx, 'cid');
    expect(result.filledFields).toHaveLength(0);
    expect(result.remainingFields).toHaveLength(0);
    expect(providerFactory.getProvider).not.toHaveBeenCalled();
  });

  it('should match and fill duration field (AC4)', async () => {
    const fields: NormalizedField[] = [
      { id: 'f1', name: 'Execution Duration', type: NormalizedFieldType.NUMBER, required: true },
    ];
    const result = await service.fillFactualFields(
      mockIntegration,
      'taskId',
      fields,
      mockCtx,
      'cid',
    );

    expect(result.filledFields).toHaveLength(1);
    expect(result.filledFields[0].field.id).toBe('f1');
    expect(result.filledFields[0].value).toBe(45);
    expect(provider.setFieldValue).toHaveBeenCalledWith('taskId', 'f1', 45);
  });

  it('should match and fill completion date field (AC5)', async () => {
    const fields: NormalizedField[] = [
      { id: 'f2', name: 'Deployed At', type: NormalizedFieldType.DATE, required: true },
    ];
    const result = await service.fillFactualFields(
      mockIntegration,
      'taskId',
      fields,
      mockCtx,
      'cid',
    );

    expect(result.filledFields).toHaveLength(1);
    expect(result.filledFields[0].value).toBe(mockCtx.deployedAt?.getTime());
    expect(provider.setFieldValue).toHaveBeenCalledWith(
      'taskId',
      'f2',
      mockCtx.deployedAt?.getTime(),
    );
  });

  it('should match and fill PR URL field (AC6)', async () => {
    const fields: NormalizedField[] = [
      { id: 'f3', name: 'Pull Request', type: NormalizedFieldType.URL, required: true },
    ];
    const result = await service.fillFactualFields(
      mockIntegration,
      'taskId',
      fields,
      mockCtx,
      'cid',
    );

    expect(result.filledFields).toHaveLength(1);
    expect(result.filledFields[0].value).toBe(mockCtx.prUrl);
    expect(provider.setFieldValue).toHaveBeenCalledWith('taskId', 'f3', mockCtx.prUrl);
  });

  it('should match and fill Branch field (AC7)', async () => {
    const fields: NormalizedField[] = [
      { id: 'f4', name: 'Git Branch', type: NormalizedFieldType.TEXT, required: true },
    ];
    const result = await service.fillFactualFields(
      mockIntegration,
      'taskId',
      fields,
      mockCtx,
      'cid',
    );

    expect(result.filledFields).toHaveLength(1);
    expect(result.filledFields[0].value).toBe(mockCtx.branchName);
    expect(provider.setFieldValue).toHaveBeenCalledWith('taskId', 'f4', mockCtx.branchName);
  });

  it('should move fields to remainingFields if no match found (AC8)', async () => {
    const fields: NormalizedField[] = [
      { id: 'f5', name: 'Random Field', type: NormalizedFieldType.TEXT, required: true },
    ];
    const result = await service.fillFactualFields(
      mockIntegration,
      'taskId',
      fields,
      mockCtx,
      'cid',
    );

    expect(result.filledFields).toHaveLength(0);
    expect(result.remainingFields).toHaveLength(1);
    expect(result.remainingFields[0].id).toBe('f5');
    expect(provider.setFieldValue).not.toHaveBeenCalled();
  });

  it('should move fields to remainingFields if context value is missing', async () => {
    const fields: NormalizedField[] = [
      { id: 'f1', name: 'Duration', type: NormalizedFieldType.NUMBER, required: true },
    ];
    const result = await service.fillFactualFields(
      mockIntegration,
      'taskId',
      fields,
      {}, // Empty context
      'cid',
    );

    expect(result.filledFields).toHaveLength(0);
    expect(result.remainingFields).toHaveLength(1);
    expect(provider.setFieldValue).not.toHaveBeenCalled();
  });

  // T4 → AC5: Leaves date/deployed field in remainingFields when deployedAt is null
  it('should leave date/deployed field in remainingFields when deployedAt is null (T4)', async () => {
    const fields: NormalizedField[] = [
      { id: 'f-deployed', name: 'Deployed At', type: NormalizedFieldType.DATE, required: true },
    ];
    const result = await service.fillFactualFields(
      mockIntegration,
      'taskId',
      fields,
      { ...mockCtx, deployedAt: null },
      'cid',
    );

    expect(result.filledFields).toHaveLength(0);
    expect(result.remainingFields).toHaveLength(1);
    expect(result.remainingFields[0].id).toBe('f-deployed');
    expect(provider.setFieldValue).not.toHaveBeenCalled();
  });

  // T6 → AC6: Fills text/pr field with prUrl (text type also matches)
  it('should fill TEXT type PR field with prUrl (T6)', async () => {
    const fields: NormalizedField[] = [
      { id: 'f-pr-text', name: 'PR Link', type: NormalizedFieldType.TEXT, required: true },
    ];
    const result = await service.fillFactualFields(
      mockIntegration,
      'taskId',
      fields,
      mockCtx,
      'cid',
    );

    expect(result.filledFields).toHaveLength(1);
    expect(result.filledFields[0].value).toBe(mockCtx.prUrl);
    expect(result.filledFields[0].source).toBe('pr_url');
    expect(provider.setFieldValue).toHaveBeenCalledWith('taskId', 'f-pr-text', mockCtx.prUrl);
  });

  // T7 → AC6: Leaves PR field in remainingFields when prUrl is null
  it('should leave PR field in remainingFields when prUrl is null (T7)', async () => {
    const fields: NormalizedField[] = [
      { id: 'f-pr', name: 'Pull Request', type: NormalizedFieldType.URL, required: true },
    ];
    const result = await service.fillFactualFields(
      mockIntegration,
      'taskId',
      fields,
      { ...mockCtx, prUrl: null },
      'cid',
    );

    expect(result.filledFields).toHaveLength(0);
    expect(result.remainingFields).toHaveLength(1);
    expect(result.remainingFields[0].id).toBe('f-pr');
    expect(provider.setFieldValue).not.toHaveBeenCalled();
  });

  // T9 → AC7: Leaves branch field in remainingFields when branchName is empty string
  it('should leave branch field in remainingFields when branchName is empty string (T9)', async () => {
    const fields: NormalizedField[] = [
      { id: 'f-branch', name: 'Git Branch', type: NormalizedFieldType.TEXT, required: true },
    ];
    const result = await service.fillFactualFields(
      mockIntegration,
      'taskId',
      fields,
      { ...mockCtx, branchName: '' },
      'cid',
    );

    expect(result.filledFields).toHaveLength(0);
    expect(result.remainingFields).toHaveLength(1);
    expect(result.remainingFields[0].id).toBe('f-branch');
    expect(provider.setFieldValue).not.toHaveBeenCalled();
  });

  it('should handle partial failures on setFieldValue and set fillFailed: true (T11, T12)', async () => {
    provider.setFieldValue
      .mockRejectedValueOnce(new Error('API Error'))
      .mockResolvedValueOnce(undefined);

    const fields: NormalizedField[] = [
      { id: 'f1', name: 'Duration', type: NormalizedFieldType.NUMBER, required: true },
      { id: 'f2', name: 'Branch', type: NormalizedFieldType.TEXT, required: true },
    ];

    const result = await service.fillFactualFields(
      mockIntegration,
      'taskId',
      fields,
      mockCtx,
      'cid',
    );

    // T11: failure sets fillFailed, warn + Sentry, field in remainingFields
    expect(result.fillFailed).toBe(true);
    expect(sentry.captureException).toHaveBeenCalled();
    expect(result.remainingFields[0].id).toBe('f1');
    // T12: failure on first field does not prevent second field being processed
    expect(result.filledFields).toHaveLength(1);
    expect(result.filledFields[0].field.id).toBe('f2');
    expect(result.remainingFields).toHaveLength(1);
  });

  // T14 → AC9: Sequential execution — second field not processed until first resolves
  it('should process fields sequentially, not in parallel (T14)', async () => {
    const callOrder: string[] = [];
    let resolveFirst!: () => void;
    const firstPromise = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });

    provider.setFieldValue.mockImplementationOnce(async (_taskId: string, fieldId: string) => {
      callOrder.push(`start-${fieldId}`);
      await firstPromise;
      callOrder.push(`end-${fieldId}`);
    });
    provider.setFieldValue.mockImplementationOnce(async (_taskId: string, fieldId: string) => {
      callOrder.push(`start-${fieldId}`);
      callOrder.push(`end-${fieldId}`);
    });

    const fields: NormalizedField[] = [
      { id: 'f1', name: 'Time Estimate', type: NormalizedFieldType.NUMBER, required: true },
      { id: 'f2', name: 'Git Branch', type: NormalizedFieldType.TEXT, required: true },
    ];

    const fillPromise = service.fillFactualFields(
      mockIntegration,
      'taskId',
      fields,
      mockCtx,
      'cid',
    );

    // Drain microtasks: let getProvider() resolve and first setFieldValue begin
    await Promise.resolve();

    // f1 has started (pushed 'start-f1' before awaiting firstPromise), f2 has not yet started
    expect(callOrder).toEqual(['start-f1']);

    // Resolve f1 and let the whole fill complete
    resolveFirst();
    await fillPromise;

    expect(callOrder).toEqual(['start-f1', 'end-f1', 'start-f2', 'end-f2']);
  });

  it('should handle provider factory failure gracefully (fail-open)', async () => {
    providerFactory.getProvider.mockRejectedValue(new Error('Config Error'));

    const fields: NormalizedField[] = [
      { id: 'f1', name: 'Duration', type: NormalizedFieldType.NUMBER, required: true },
    ];
    const result = await service.fillFactualFields(
      mockIntegration,
      'taskId',
      fields,
      mockCtx,
      'cid',
    );

    expect(result.filledFields).toHaveLength(0);
    expect(result.remainingFields).toHaveLength(1);
    expect(result.fillFailed).toBe(true);
  });
});
