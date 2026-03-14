/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test, TestingModule } from '@nestjs/testing';
import { DeploymentStatusSync } from './deployment-status-sync.service';
import { PrismaService } from '../../database/prisma.service';
import { ClickUpService } from '../../clickup/clickup.service';
import { MetricsService } from '../../common/metrics/metrics.service';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { SentryService } from '../../common/sentry/sentry.service';
import { ProjectIntegrationService } from '@/integrations/project-integration.service';
import { PMFieldPreCheckService } from '@/integrations/pm-field-pre-check.service';
import { PMFieldAutoFillService } from '@/integrations/pm-field-auto-fill.service';

import { DeploymentStatus } from '@/prisma/client';

describe('DeploymentStatusSync', () => {
  let module: TestingModule;
  let service: DeploymentStatusSync;
  let prisma: PrismaService;
  let clickUp: ClickUpService;
  let metrics: MetricsService;
  let auditLog: AuditLogService;
  let sentry: SentryService;

  const mockDeployment = {
    id: 'deployment-123',
    github_push_id: 'push-456',
    environment: 'production',
    cicd_provider: 'github-actions',
    build_id: '789',
    workflow_id: 'deploy.yml',
    status: DeploymentStatus.COMPLETED,
    deployed_at: new Date('2025-12-08T12:00:00Z'),
    created_at: new Date('2025-12-08T11:50:00Z'),
    updated_at: new Date('2025-12-08T12:00:00Z'),
    error_message: null,
    github_push: {
      id: 'push-456',
      commit_sha: 'abc123def456',
      pr_url: 'https://github.com/org/repo/pull/42',
      pr_number: 42,
      repository: 'org/repo',
      branch_name: 'feature/factual',
      execution_id: 'exec-789',
      error_message: null,
    },
  };

  const mockExecution = {
    id: 'exec-789',
    ticket_id: 'ticket-001',
    retry_count: 1,
    files_changed: ['file1.js', 'file2.js'],
    started_at: new Date('2025-12-08T11:50:00Z'),
    completed_at: new Date('2025-12-08T12:00:00Z'),
    ticket: {
      project_id: 'proj-123',
      clickup_task_id: 'clickup-123',
      title: 'Fix Bug',
      description: 'The bug is here',
    },
  };

  beforeEach(async () => {
    module = await Test.createTestingModule({
      providers: [
        DeploymentStatusSync,
        {
          provide: PrismaService,
          useValue: {
            deployment: {
              findUnique: jest.fn(),
            },
            execution: {
              findUnique: jest.fn(),
            },
          },
        },
        {
          provide: ClickUpService,
          useValue: {
            updateStatus: jest.fn(),
            addComment: jest.fn(),
          },
        },
        {
          provide: MetricsService,
          useValue: {
            recordDeployment: jest.fn(),
            incrementErrors: jest.fn(),
            incrementCounter: jest.fn(), // Story 4.6 fix
            recordHistogram: jest.fn(), // Story 4.6 fix
          },
        },
        {
          provide: AuditLogService,
          useValue: {
            log: jest.fn(),
          },
        },
        {
          provide: SentryService,
          useValue: {
            captureException: jest.fn(),
          },
        },
        {
          provide: ProjectIntegrationService,
          useValue: {
            findFirstByProject: jest.fn(),
          },
        },
        {
          provide: PMFieldPreCheckService,
          useValue: {
            checkRequiredFields: jest.fn(),
          },
        },
        {
          provide: PMFieldAutoFillService,
          useValue: {
            fillFactualFields: jest
              .fn()
              .mockResolvedValue({ filledFields: [], remainingFields: [] }),
            fillInferredFields: jest.fn().mockResolvedValue({ filledFields: [], manualFields: [] }),
          },
        },
      ],
    }).compile();

    service = module.get<DeploymentStatusSync>(DeploymentStatusSync);
    prisma = module.get<PrismaService>(PrismaService);
    clickUp = module.get<ClickUpService>(ClickUpService);
    metrics = module.get<MetricsService>(MetricsService);
    auditLog = module.get<AuditLogService>(AuditLogService);
    sentry = module.get<SentryService>(SentryService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('syncToClickUp', () => {
    it('should successfully sync deployment status and comment', async () => {
      (prisma.deployment.findUnique as jest.Mock).mockResolvedValue(mockDeployment);
      (prisma.execution.findUnique as jest.Mock).mockResolvedValue(mockExecution);
      (clickUp.updateStatus as jest.Mock).mockResolvedValue(true);
      (clickUp.addComment as jest.Mock).mockResolvedValue(true);

      await service.syncToClickUp('deployment-123');

      expect(clickUp.updateStatus).toHaveBeenCalledWith(
        'clickup-123',
        'Deployed',
        expect.objectContaining({ correlationId: expect.any(String) }),
      );
      expect(clickUp.addComment).toHaveBeenCalledWith(
        'clickup-123',
        expect.stringContaining('🚀 **Deployment Successful**'),
        expect.any(Object),
      );
      // Service uses Story 4.8 metrics API (incrementCounter + recordHistogram)
      expect(metrics.incrementCounter).toHaveBeenCalledWith('deployment_status_sync_total', {
        environment: 'production',
        status: 'success',
      });
      expect(metrics.recordHistogram).toHaveBeenCalledWith(
        'deployment_status_sync_duration_seconds',
        expect.any(Number),
        { environment: 'production' },
      );
      expect(auditLog.log).toHaveBeenCalled();
    });

    it('should gracefully handle deployment not found', async () => {
      (prisma.deployment.findUnique as jest.Mock).mockResolvedValue(null);

      // Should NOT throw - graceful degradation catches all errors
      await service.syncToClickUp('invalid-id');

      // Sentry should be notified of the NotFoundException
      expect(sentry.captureException).toHaveBeenCalled();
    });

    it('should gracefully skip if github_push relation missing', async () => {
      const deploymentNoRelation = { ...mockDeployment, github_push: null } as unknown;
      (prisma.deployment.findUnique as jest.Mock).mockResolvedValue(deploymentNoRelation);

      await service.syncToClickUp('deployment-123');

      expect(clickUp.updateStatus).not.toHaveBeenCalled();
      expect(clickUp.addComment).not.toHaveBeenCalled();
    });

    it('should gracefully skip if execution relation missing', async () => {
      (prisma.deployment.findUnique as jest.Mock).mockResolvedValue(mockDeployment);
      (prisma.execution.findUnique as jest.Mock).mockResolvedValue({
        ...mockExecution,
        ticket: null,
      });

      await service.syncToClickUp('deployment-123');

      expect(clickUp.updateStatus).not.toHaveBeenCalled();
      expect(clickUp.addComment).not.toHaveBeenCalled();
    });

    it('should handle status update failure gracefully (AC#3)', async () => {
      (prisma.deployment.findUnique as jest.Mock).mockResolvedValue(mockDeployment);
      (prisma.execution.findUnique as jest.Mock).mockResolvedValue(mockExecution);
      (clickUp.updateStatus as jest.Mock).mockResolvedValue(false); // Status update failed

      await service.syncToClickUp('deployment-123');

      expect(metrics.incrementCounter).toHaveBeenCalledWith(
        'deployment_status_sync_total',
        expect.objectContaining({ status: 'failed' }),
      );
      expect(auditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          afterState: expect.objectContaining({ success: false }),
        }),
      );
      expect(clickUp.addComment).not.toHaveBeenCalled(); // Should NOT add comment if status update failed
    });

    it('should continue if comment fails but status succeeded', async () => {
      (prisma.deployment.findUnique as jest.Mock).mockResolvedValue(mockDeployment);
      (prisma.execution.findUnique as jest.Mock).mockResolvedValue(mockExecution);
      (clickUp.updateStatus as jest.Mock).mockResolvedValue(true);
      (clickUp.addComment as jest.Mock).mockResolvedValue(false); // Comment failed

      await service.syncToClickUp('deployment-123');

      expect(metrics.incrementCounter).toHaveBeenCalledWith(
        'deployment_status_sync_total',
        expect.objectContaining({ status: 'success' }),
      );
    });

    // T-DSS1: When findFirstByProject returns null, checkRequiredFields is NOT called
    it('T-DSS1: skips pre-check pipeline when no integration found', async () => {
      const integrationService = module.get(ProjectIntegrationService);
      const preCheckService = module.get(PMFieldPreCheckService);

      (prisma.deployment.findUnique as jest.Mock).mockResolvedValue(mockDeployment);
      (prisma.execution.findUnique as jest.Mock).mockResolvedValue(mockExecution);
      (clickUp.updateStatus as jest.Mock).mockResolvedValue(true);
      (clickUp.addComment as jest.Mock).mockResolvedValue(true);
      (integrationService.findFirstByProject as jest.Mock).mockResolvedValue(null);

      await service.syncToClickUp('deployment-123');

      expect(preCheckService.checkRequiredFields).not.toHaveBeenCalled();
      expect(clickUp.updateStatus).toHaveBeenCalled();
    });

    // T-DSS2: When integration exists and allFilled === false, fillFactualFields IS called
    it('T-DSS2: calls fillFactualFields when integration exists and fields are missing', async () => {
      const integrationService = module.get(ProjectIntegrationService);
      const preCheckService = module.get(PMFieldPreCheckService);
      const autoFillService = module.get(PMFieldAutoFillService);

      const mockIntegration = {
        id: 'int-1',
        provider_config: { containerId: 'list-123' },
      };
      const missingFields = [{ id: 'f1', name: 'Duration', type: 'NUMBER', required: true }];

      (prisma.deployment.findUnique as jest.Mock).mockResolvedValue(mockDeployment);
      (prisma.execution.findUnique as jest.Mock).mockResolvedValue(mockExecution);
      (clickUp.updateStatus as jest.Mock).mockResolvedValue(true);
      (clickUp.addComment as jest.Mock).mockResolvedValue(true);
      (integrationService.findFirstByProject as jest.Mock).mockResolvedValue(mockIntegration);
      (preCheckService.checkRequiredFields as jest.Mock).mockResolvedValue({
        allFilled: false,
        missingFields,
      });
      (autoFillService.fillFactualFields as jest.Mock).mockResolvedValue({
        filledFields: [],
        remainingFields: missingFields,
      });

      await service.syncToClickUp('deployment-123');

      expect(autoFillService.fillFactualFields).toHaveBeenCalledWith(
        mockIntegration,
        'clickup-123',
        missingFields,
        expect.objectContaining({
          deployedAt: mockDeployment.deployed_at,
          prUrl: mockDeployment.github_push.pr_url,
          branchName: mockDeployment.github_push.branch_name,
        }),
        expect.any(String),
      );
      expect(clickUp.updateStatus).toHaveBeenCalled();
    });

    // T-DSS3: When the pipeline block throws unexpectedly, clickUp.updateStatus() still runs
    it('T-DSS3: updateStatus still runs when pipeline throws unexpectedly (fail-open)', async () => {
      const integrationService = module.get(ProjectIntegrationService);

      (prisma.deployment.findUnique as jest.Mock).mockResolvedValue(mockDeployment);
      (prisma.execution.findUnique as jest.Mock).mockResolvedValue(mockExecution);
      (clickUp.updateStatus as jest.Mock).mockResolvedValue(true);
      (clickUp.addComment as jest.Mock).mockResolvedValue(true);
      (integrationService.findFirstByProject as jest.Mock).mockRejectedValue(
        new Error('DB connection lost'),
      );

      await service.syncToClickUp('deployment-123');

      expect(clickUp.updateStatus).toHaveBeenCalledWith(
        'clickup-123',
        'Deployed',
        expect.any(Object),
      );
    });

    // T-DSS5: When factualResult.remainingFields is empty, fillInferredFields is NOT called
    it('T-DSS5: skips fillInferredFields when factual fill leaves no remaining fields', async () => {
      const integrationService = module.get(ProjectIntegrationService);
      const preCheckService = module.get(PMFieldPreCheckService);
      const autoFillService = module.get(PMFieldAutoFillService);

      const mockIntegration = { id: 'int-1', provider_config: { containerId: 'list-123' } };
      const missingFields = [{ id: 'f1', name: 'Duration', type: 'NUMBER', required: true }];

      (prisma.deployment.findUnique as jest.Mock).mockResolvedValue(mockDeployment);
      (prisma.execution.findUnique as jest.Mock).mockResolvedValue(mockExecution);
      (clickUp.updateStatus as jest.Mock).mockResolvedValue(true);
      (clickUp.addComment as jest.Mock).mockResolvedValue(true);
      (integrationService.findFirstByProject as jest.Mock).mockResolvedValue(mockIntegration);
      (preCheckService.checkRequiredFields as jest.Mock).mockResolvedValue({
        allFilled: false,
        missingFields,
      });
      // Factual fill resolves all fields — no remaining
      (autoFillService.fillFactualFields as jest.Mock).mockResolvedValue({
        filledFields: [{ field: missingFields[0], value: 45, source: 'duration' }],
        remainingFields: [],
      });

      await service.syncToClickUp('deployment-123');

      expect(autoFillService.fillInferredFields).not.toHaveBeenCalled();
      expect(clickUp.updateStatus).toHaveBeenCalled();
    });

    // T-DSS4: Calls fillInferredFields when factual fill leaves remaining fields
    it('T-DSS4: calls fillInferredFields when factual fill leaves remaining fields', async () => {
      const integrationService = module.get(ProjectIntegrationService);
      const preCheckService = module.get(PMFieldPreCheckService);
      const autoFillService = module.get(PMFieldAutoFillService);

      const mockIntegration = { id: 'int-1' };
      const missingFields = [
        { id: 'f1', name: 'Duration', type: 'NUMBER', required: true },
        { id: 'f2', name: 'Story Points', type: 'NUMBER', required: true },
      ];

      (prisma.deployment.findUnique as jest.Mock).mockResolvedValue(mockDeployment);
      (prisma.execution.findUnique as jest.Mock).mockResolvedValue(mockExecution);
      (clickUp.updateStatus as jest.Mock).mockResolvedValue(true);
      (clickUp.addComment as jest.Mock).mockResolvedValue(true);
      (integrationService.findFirstByProject as jest.Mock).mockResolvedValue(mockIntegration);
      (preCheckService.checkRequiredFields as jest.Mock).mockResolvedValue({
        allFilled: false,
        missingFields,
      });

      // Factual fill fills f1, leaving f2
      (autoFillService.fillFactualFields as jest.Mock).mockResolvedValue({
        filledFields: [{ field: missingFields[0], value: 10, source: 'duration' }],
        remainingFields: [missingFields[1]],
      });

      await service.syncToClickUp('deployment-123');

      expect(autoFillService.fillInferredFields).toHaveBeenCalledWith(
        mockIntegration,
        'clickup-123',
        [missingFields[1]],
        expect.objectContaining({
          ticketTitle: 'Fix Bug',
          retryCount: 1,
          filesChangedCount: 2,
        }),
        expect.any(String),
      );
    });
  });

  describe('buildDeploymentComment', () => {
    it('should build success comment with all metadata', () => {
      const comment = (service as any).buildDeploymentComment(
        mockDeployment,
        mockDeployment.github_push,
      );

      expect(comment).toContain('🚀 **Deployment Successful**');
      expect(comment).toContain('production');
      expect(comment).toContain('abc123d'); // Short SHA
      expect(comment).toContain('https://github.com/org/repo/commit/abc123def456');
      expect(comment).toContain('https://github.com/org/repo/pull/42');
      expect(comment).toContain('https://github.com/org/repo/actions/runs/789');
    });

    it('should build failure comment with sanitized error', () => {
      const failedDeployment = {
        ...mockDeployment,
        status: DeploymentStatus.FAILED,
        error_message: 'Connection timeout to database service with token: sk_live_abc123xyz789',
      };

      const comment = (service as any).buildDeploymentComment(
        failedDeployment,
        mockDeployment.github_push,
      );

      expect(comment).toContain('❌ **Deployment Failed**');
      expect(comment).toContain('**Required Actions:**');
      expect(comment).not.toContain('sk_live_abc123xyz789'); // Secret should be redacted
    });

    it('should build rollback comment', () => {
      const rolledBackDeployment = {
        ...mockDeployment,
        status: DeploymentStatus.ROLLED_BACK,
      };

      const comment = (service as any).buildDeploymentComment(
        rolledBackDeployment,
        mockDeployment.github_push,
      );

      expect(comment).toContain('🔄 **Deployment Rolled Back**');
      expect(comment).toContain('**Next Steps:**');
    });
  });

  describe('sanitizeErrorMessage', () => {
    it('should redact long alphanumeric secrets (M2 simplified approach)', () => {
      const errorWithSecret =
        'Authentication failed: token sk_live_1234567890abcdef1234567890 invalid';

      const sanitized = (service as any).sanitizeErrorMessage(errorWithSecret);

      expect(sanitized).not.toContain('sk_live_1234567890abcdef1234567890');
      // Pattern: first 4 chars + *** + last 4 chars
      expect(sanitized).toContain('sk_l***7890');
    });

    it('should redact long strings and truncate to 500 characters', () => {
      const longError = 'x'.repeat(600);

      const sanitized = (service as any).sanitizeErrorMessage(longError);

      // Long string gets redacted to "x***x" pattern, result is much shorter
      expect(sanitized.length).toBeLessThan(100); // Redaction makes it tiny
      expect(sanitized).toContain('***'); // Redaction pattern present
    });

    it('should preserve short error messages', () => {
      const shortError = 'Connection timeout';

      const sanitized = (service as any).sanitizeErrorMessage(shortError);

      expect(sanitized).toBe('Connection timeout');
    });
  });
});
