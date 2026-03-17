import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { PMVerificationCommentService } from './pm-verification-comment.service';
import { PMProviderFactory } from './providers/pm-provider.factory';
import { SentryService } from '@/common/sentry/sentry.service';
import { IPMProvider } from './providers/pm-provider.interface';
import { NormalizedFieldType } from './providers/dto/normalized-field.dto';
import { ProjectIntegration, PMProvider } from '@/prisma/client';

describe('PMVerificationCommentService', () => {
  let service: PMVerificationCommentService;
  let providerFactory: jest.Mocked<PMProviderFactory>;
  let provider: jest.Mocked<IPMProvider>;
  let sentry: jest.Mocked<SentryService>;

  const mockIntegration: ProjectIntegration = {
    id: 'int-123',
    project_id: 'proj-123',
    provider: PMProvider.CLICKUP,
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

  const mockFactual = [
    {
      field: { id: 'f1', name: 'Duration', type: NormalizedFieldType.NUMBER, required: true },
      value: 45,
      source: 'execution_duration' as const,
    },
    {
      field: { id: 'f2', name: 'PR', type: NormalizedFieldType.URL, required: true },
      value: 'https://github.com/pull/1',
      source: 'pr_url' as const,
    },
  ];

  const mockInferred = [
    {
      field: { id: 'f3', name: 'Points', type: NormalizedFieldType.NUMBER, required: true },
      value: 5,
      source: 'ai_inferred' as const,
    },
  ];

  const mockManual = [
    { id: 'f4', name: 'Reviewer', type: NormalizedFieldType.USER, required: true },
  ];

  beforeEach(async () => {
    provider = {
      addComment: jest.fn().mockResolvedValue(undefined),
    } as any;

    providerFactory = {
      getProvider: jest.fn().mockResolvedValue(provider),
    } as any;

    sentry = {
      captureException: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PMVerificationCommentService,
        { provide: PMProviderFactory, useValue: providerFactory },
        { provide: SentryService, useValue: sentry },
      ],
    }).compile();

    service = module.get<PMVerificationCommentService>(PMVerificationCommentService);

    // Disable logging for tests
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should be defined (T-V1)', () => {
    expect(service).toBeDefined();
  });

  it('should early exit if factual, inferred, and manual fields are all empty (T-V2)', async () => {
    await service.postVerificationComment(mockIntegration, 'taskId', [], [], [], 'cid');
    expect(providerFactory.getProvider).not.toHaveBeenCalled();
    expect(provider.addComment).not.toHaveBeenCalled();
  });

  it('should include factual fields section if factual fields are filled (T-V3)', async () => {
    await service.postVerificationComment(mockIntegration, 'taskId', mockFactual, [], [], 'cid');
    expect(provider.addComment).toHaveBeenCalled();
    const comment = provider.addComment.mock.calls[0][1];
    expect(comment).toContain('✅ Factual fields');
    expect(comment).toContain('• Duration: 45 min');
  });

  it('should include both factual and inferred sections if both filled (T-V4)', async () => {
    await service.postVerificationComment(
      mockIntegration,
      'taskId',
      mockFactual,
      mockInferred,
      [],
      'cid',
    );
    const comment = provider.addComment.mock.calls[0][1];
    expect(comment).toContain('✅ Factual fields');
    expect(comment).toContain('🤖 AI-estimated fields');
    expect(comment).toContain('• Points: 5');
  });

  it('should include inferred fields section even if factual is empty (T-V5)', async () => {
    await service.postVerificationComment(mockIntegration, 'taskId', [], mockInferred, [], 'cid');
    const comment = provider.addComment.mock.calls[0][1];
    expect(comment).not.toContain('✅ Factual fields');
    expect(comment).toContain('🤖 AI-estimated fields');
    expect(comment).toContain('• Points: 5');
  });

  it('should omit manual section if no manual fields remain (T-V6)', async () => {
    await service.postVerificationComment(mockIntegration, 'taskId', mockFactual, [], [], 'cid');
    const comment = provider.addComment.mock.calls[0][1];
    expect(comment).not.toContain('⚠️ Fields requiring manual input');
  });

  it('should include manual section if manual fields exist (T-V7)', async () => {
    await service.postVerificationComment(
      mockIntegration,
      'taskId',
      mockFactual,
      [],
      mockManual,
      'cid',
    );
    const comment = provider.addComment.mock.calls[0][1];
    expect(comment).toContain('⚠️ Fields requiring manual input');
    expect(comment).toContain('• Reviewer (type: user)');
  });

  it('should format execution_duration with min suffix (T-V8)', async () => {
    const factual = [
      {
        field: { id: 'f1', name: 'Duration', type: NormalizedFieldType.NUMBER, required: true },
        value: 120,
        source: 'execution_duration' as const,
      },
    ];
    await service.postVerificationComment(mockIntegration, 'taskId', factual, [], [], 'cid');
    const comment = provider.addComment.mock.calls[0][1];
    expect(comment).toContain('• Duration: 120 min');
  });

  it('should format deployed_at as ISO string (T-V9)', async () => {
    const now = new Date();
    const factual = [
      {
        field: { id: 'f1', name: 'Timestamp', type: NormalizedFieldType.DATE, required: true },
        value: now.getTime(),
        source: 'deployed_at' as const,
      },
    ];
    await service.postVerificationComment(mockIntegration, 'taskId', factual, [], [], 'cid');
    const comment = provider.addComment.mock.calls[0][1];
    expect(comment).toContain(`• Timestamp: ${now.toISOString()}`);
  });

  it('should fail-open if provider.addComment throws (T-V10)', async () => {
    const error = new Error('API Error');
    provider.addComment.mockRejectedValue(error);
    const warnSpy = jest.spyOn(Logger.prototype, 'warn');

    await service.postVerificationComment(mockIntegration, 'taskId', mockFactual, [], [], 'cid');

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('API Error'));
    expect(sentry.captureException).toHaveBeenCalledWith(error);
    // Should NOT rethrow
  });

  it('should format field type in manual section (T-V11)', async () => {
    const manual = [{ id: 'f1', name: 'Note', type: NormalizedFieldType.TEXT, required: true }];
    await service.postVerificationComment(
      mockIntegration,
      'taskId',
      mockFactual,
      [],
      manual,
      'cid',
    );
    const comment = provider.addComment.mock.calls[0][1];
    expect(comment).toContain('• Note (type: text)');
  });

  it('should fail-open if providerFactory.getProvider fails (T-V12)', async () => {
    const error = new Error('Factory Error');
    providerFactory.getProvider.mockRejectedValue(error);
    const warnSpy = jest.spyOn(Logger.prototype, 'warn');

    await service.postVerificationComment(mockIntegration, 'taskId', mockFactual, [], [], 'cid');

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Factory Error'));
    expect(sentry.captureException).toHaveBeenCalledWith(error);
    // Should NOT rethrow
  });

  it('should NOT post comment if only manual fields exist but no fields were filled (T-V13)', async () => {
    await service.postVerificationComment(mockIntegration, 'taskId', [], [], mockManual, 'cid');
    expect(provider.addComment).not.toHaveBeenCalled();
  });

  it('comment starts with 📋 DSF Auto-Fill Summary header (T-V7 → AC6)', async () => {
    await service.postVerificationComment(mockIntegration, 'taskId', mockFactual, [], [], 'cid');
    const comment: string = provider.addComment.mock.calls[0][1];
    expect(comment.startsWith('📋 DSF Auto-Fill Summary')).toBe(true);
  });

  it('addComment is called with header and at least one field entry (T-V10 → AC7)', async () => {
    await service.postVerificationComment(
      mockIntegration,
      'taskId',
      mockFactual,
      mockInferred,
      [],
      'cid',
    );
    expect(provider.addComment).toHaveBeenCalledTimes(1);
    const [calledTaskId, comment]: [string, string] = provider.addComment.mock.calls[0];
    expect(calledTaskId).toBe('taskId');
    expect(comment).toContain('📋 DSF Auto-Fill Summary');
    expect(comment).toMatch(/• .+: .+/); // At least one field entry
  });
});
