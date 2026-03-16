/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test, TestingModule } from '@nestjs/testing';
import { DeploymentStatusSyncService } from './deployment-status-sync.service';
import { PrismaService } from '@/database/prisma.service';
import { ClickUpService } from '@/clickup/clickup.service';
import { MetricsService } from '@/common/metrics/metrics.service';
import { AuditLogService } from '@/common/audit/audit-log.service';
import { SentryService } from '@/common/sentry/sentry.service';
import { ProjectIntegrationService } from '@/integrations/project-integration.service';
import { PMFieldPreCheckService } from '@/integrations/pm-field-pre-check.service';
import { PMFieldAutoFillService } from '@/integrations/pm-field-auto-fill.service';
import { PMVerificationCommentService } from '@/integrations/pm-verification-comment.service';
import { PMActionableFailureCommentService } from '@/integrations/pm-actionable-failure-comment.service';
import { PMProviderClientError } from '@/integrations/providers/pm-provider-client.error';
import { RealtimeService } from '@/realtime/realtime.service';
import { DeploymentStatus } from '@/prisma/client';

describe('DeploymentStatusSyncService', () => {
  let module: TestingModule;
  let service: DeploymentStatusSyncService;
  let prisma: PrismaService;
  let clickUp: ClickUpService;
  let metrics: MetricsService;
  let auditLog: AuditLogService;
  let sentry: SentryService;
  let realtimeService: RealtimeService;
  let integrationService: ProjectIntegrationService;
  let preCheckService: PMFieldPreCheckService;

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
      id: 'ticket-001',
      project_id: 'proj-123',
      clickup_task_id: 'clickup-123',
      title: 'Fix Bug',
      description: 'The bug is here',
    },
  };

  beforeEach(async () => {
    module = await Test.createTestingModule({
      providers: [
        DeploymentStatusSyncService,
        {
          provide: PrismaService,
          useValue: {
            deployment: {
              findUnique: jest.fn(),
            },
            execution: {
              findUnique: jest.fn(),
            },
            ticket: {
              update: jest.fn(),
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
        {
          provide: PMVerificationCommentService,
          useValue: {
            postVerificationComment: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: PMActionableFailureCommentService,
          useValue: {
            postActionableFailureComment: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: RealtimeService,
          useValue: {
            emitToRole: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<DeploymentStatusSyncService>(DeploymentStatusSyncService);
    prisma = module.get<PrismaService>(PrismaService);
    clickUp = module.get<ClickUpService>(ClickUpService);
    metrics = module.get<MetricsService>(MetricsService);
    auditLog = module.get<AuditLogService>(AuditLogService);
    sentry = module.get<SentryService>(SentryService);
    realtimeService = module.get<RealtimeService>(RealtimeService);
    integrationService = module.get<ProjectIntegrationService>(ProjectIntegrationService);
    preCheckService = module.get<PMFieldPreCheckService>(PMFieldPreCheckService);
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

    // T-DSS6: Calls postVerificationComment with correct arguments after auto-fill blocks
    it('T-DSS6: calls postVerificationComment after successful auto-fill blocks', async () => {
      const integrationService = module.get(ProjectIntegrationService);
      const preCheckService = module.get(PMFieldPreCheckService);
      const autoFillService = module.get(PMFieldAutoFillService);
      const commentService = module.get(PMVerificationCommentService);

      const mockIntegration = { id: 'int-1' };
      const missingFields = [{ id: 'f1', name: 'Duration', type: 'NUMBER', required: true }];
      const factualFilled = [{ field: missingFields[0], value: 45, source: 'duration' }];

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
        filledFields: factualFilled,
        remainingFields: [],
      });

      await service.syncToClickUp('deployment-123');

      expect(commentService.postVerificationComment).toHaveBeenCalledWith(
        mockIntegration,
        'clickup-123',
        factualFilled,
        [], // no inferred
        [], // no manual/remaining
        expect.any(String),
      );
    });

    // T-DSS7: Ensures postVerificationComment is called even if fillFactualFields fails partially but does not throw
    it('T-DSS7: calls postVerificationComment even if factual fill fails partially', async () => {
      const integrationService = module.get(ProjectIntegrationService);
      const preCheckService = module.get(PMFieldPreCheckService);
      const autoFillService = module.get(PMFieldAutoFillService);
      const commentService = module.get(PMVerificationCommentService);

      const mockIntegration = { id: 'int-1' };
      const missingFields = [{ id: 'f1', name: 'Duration', type: 'NUMBER', required: true }];

      (prisma.deployment.findUnique as jest.Mock).mockResolvedValue(mockDeployment);
      (prisma.execution.findUnique as jest.Mock).mockResolvedValue(mockExecution);
      (clickUp.updateStatus as jest.Mock).mockResolvedValue(true);
      (integrationService.findFirstByProject as jest.Mock).mockResolvedValue(mockIntegration);
      (preCheckService.checkRequiredFields as jest.Mock).mockResolvedValue({
        allFilled: false,
        missingFields,
      });

      // Factual fill fails partially (returns remaining fields)
      (autoFillService.fillFactualFields as jest.Mock).mockResolvedValue({
        filledFields: [],
        remainingFields: missingFields,
        fillFailed: true,
      });

      // Inferred fill also returns these as manual
      (autoFillService.fillInferredFields as jest.Mock).mockResolvedValue({
        filledFields: [],
        manualFields: missingFields,
      });

      await service.syncToClickUp('deployment-123');

      expect(commentService.postVerificationComment).toHaveBeenCalled();
      expect(commentService.postVerificationComment).toHaveBeenCalledWith(
        mockIntegration,
        'clickup-123',
        [],
        [],
        missingFields,
        expect.any(String),
      );
    });

    // T-DSS8: fillInferredFields fail-open (AC#4 fix)
    it('T-DSS8: continues to postVerificationComment even if fillInferredFields throws (fail-open)', async () => {
      const integrationService = module.get(ProjectIntegrationService);
      const preCheckService = module.get(PMFieldPreCheckService);
      const autoFillService = module.get(PMFieldAutoFillService);
      const commentService = module.get(PMVerificationCommentService);

      const mockIntegration = { id: 'int-1' };
      const missingFields = [{ id: 'f1', name: 'Points', type: 'NUMBER', required: true }];

      (prisma.deployment.findUnique as jest.Mock).mockResolvedValue(mockDeployment);
      (prisma.execution.findUnique as jest.Mock).mockResolvedValue(mockExecution);
      (clickUp.updateStatus as jest.Mock).mockResolvedValue(true);
      (integrationService.findFirstByProject as jest.Mock).mockResolvedValue(mockIntegration);
      (preCheckService.checkRequiredFields as jest.Mock).mockResolvedValue({
        allFilled: false,
        missingFields,
      });

      // Factual fill leaves fields for AI
      (autoFillService.fillFactualFields as jest.Mock).mockResolvedValue({
        filledFields: [],
        remainingFields: missingFields,
      });

      // AI fill throws
      (autoFillService.fillInferredFields as jest.Mock).mockRejectedValue(
        new Error('AI Service Down'),
      );

      await service.syncToClickUp('deployment-123');

      // Should still call comment service
      expect(commentService.postVerificationComment).toHaveBeenCalledWith(
        mockIntegration,
        'clickup-123',
        [],
        [],
        missingFields, // Fallback to factual remaining fields
        expect.any(String),
      );
      expect(sentry.captureException).toHaveBeenCalled();
    });

    // T-DSS9: Nullish coalescing for manualFields (logical error fix)
    it('T-DSS9: uses factual remaining fields if AI fill fails to provide manualFields (?? fallback)', async () => {
      const integrationService = module.get(ProjectIntegrationService);
      const preCheckService = module.get(PMFieldPreCheckService);
      const autoFillService = module.get(PMFieldAutoFillService);
      const commentService = module.get(PMVerificationCommentService);

      const mockIntegration = { id: 'int-1' };
      const missingFields = [{ id: 'f1', name: 'Points', type: 'NUMBER', required: true }];

      (prisma.deployment.findUnique as jest.Mock).mockResolvedValue(mockDeployment);
      (prisma.execution.findUnique as jest.Mock).mockResolvedValue(mockExecution);
      (integrationService.findFirstByProject as jest.Mock).mockResolvedValue(mockIntegration);
      (preCheckService.checkRequiredFields as jest.Mock).mockResolvedValue({
        allFilled: false,
        missingFields,
      });

      (autoFillService.fillFactualFields as jest.Mock).mockResolvedValue({
        filledFields: [],
        remainingFields: missingFields,
      });

      // AI fill returns valid empty arrays (not null/undefined)
      (autoFillService.fillInferredFields as jest.Mock).mockResolvedValue({
        filledFields: [],
        manualFields: [],
      });

      await service.syncToClickUp('deployment-123');

      // Should use empty array from AI, NOT fallback to missingFields
      expect(commentService.postVerificationComment).toHaveBeenCalledWith(
        mockIntegration,
        'clickup-123',
        [],
        [],
        [], // Should be empty because AI returned empty array
        expect.any(String),
      );
    });

    it('T-PS1: success path sets pm_synced=true', async () => {
      (prisma.deployment.findUnique as jest.Mock).mockResolvedValue(mockDeployment);
      (prisma.execution.findUnique as jest.Mock).mockResolvedValue(mockExecution);
      (clickUp.updateStatus as jest.Mock).mockResolvedValue(true);
      (prisma.ticket.update as jest.Mock).mockResolvedValue({ id: 'ticket-001', pm_synced: true });

      await service.syncToClickUp('deployment-123');

      expect(prisma.ticket.update).toHaveBeenCalledWith({
        where: { id: 'ticket-001' },
        data: { pm_synced: true },
      });
    });

    it('T-PS2/3: soft failure sets pm_synced=false and audits', async () => {
      (prisma.deployment.findUnique as jest.Mock).mockResolvedValue(mockDeployment);
      (prisma.execution.findUnique as jest.Mock).mockResolvedValue(mockExecution);
      (clickUp.updateStatus as jest.Mock).mockResolvedValue(false);

      await service.syncToClickUp('deployment-123');

      expect(prisma.ticket.update).toHaveBeenCalledWith({
        where: { id: 'ticket-001' },
        data: { pm_synced: false },
      });
      expect(auditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'ticket',
          action: 'pm_sync_failed',
          afterState: expect.objectContaining({
            errorCode: 'STATUS_UPDATE_RETURNED_FALSE',
          }),
        }),
      );
    });

    it('T-PS4/5: exception path sets pm_synced=false and audits', async () => {
      (prisma.deployment.findUnique as jest.Mock).mockResolvedValue(mockDeployment);
      (prisma.execution.findUnique as jest.Mock).mockResolvedValue(mockExecution);
      (clickUp.updateStatus as jest.Mock).mockRejectedValue(new Error('Network Error'));

      await service.syncToClickUp('deployment-123');

      expect(prisma.ticket.update).toHaveBeenCalledWith({
        where: { id: 'ticket-001' },
        data: { pm_synced: false },
      });
      expect(auditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'ticket',
          action: 'pm_sync_failed',
          afterState: expect.objectContaining({
            errorCode: 'Error',
          }),
        }),
      );
    });

    it('T-PS6: skips update if ticket resolution fails', async () => {
      (prisma.deployment.findUnique as jest.Mock).mockResolvedValue(mockDeployment);
      (prisma.execution.findUnique as jest.Mock).mockRejectedValue(new Error('DB Error'));

      await service.syncToClickUp('deployment-123');

      expect(prisma.ticket.update).not.toHaveBeenCalled();
      expect(auditLog.log).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'pm_sync_failed' }),
      );
    });

    it('T-PS7: update failure does not block flow', async () => {
      (prisma.deployment.findUnique as jest.Mock).mockResolvedValue(mockDeployment);
      (prisma.execution.findUnique as jest.Mock).mockResolvedValue(mockExecution);
      (clickUp.updateStatus as jest.Mock).mockResolvedValue(true);
      (prisma.ticket.update as jest.Mock).mockRejectedValue(new Error('Update failed'));

      await service.syncToClickUp('deployment-123');

      // Flow continues to completion recording
      expect(metrics.incrementCounter).toHaveBeenCalledWith('deployment_status_sync_total', {
        environment: 'production',
        status: 'success',
      });
    });

    it('T-PS8: comment failure does not affect pm_synced=true', async () => {
      (prisma.deployment.findUnique as jest.Mock).mockResolvedValue(mockDeployment);
      (prisma.execution.findUnique as jest.Mock).mockResolvedValue(mockExecution);
      (clickUp.updateStatus as jest.Mock).mockResolvedValue(true);
      (clickUp.addComment as jest.Mock).mockRejectedValue(new Error('Comment failed'));

      await service.syncToClickUp('deployment-123');

      expect(prisma.ticket.update).toHaveBeenCalledWith({
        where: { id: 'ticket-001' },
        data: { pm_synced: true },
      });
      // addComment throw must NOT reach the outer catch and overwrite pm_synced with false
      expect(prisma.ticket.update).not.toHaveBeenCalledWith({
        where: { id: 'ticket-001' },
        data: { pm_synced: false },
      });
    });

    it('T-PS9: exception path handles non-Error object throws safely', async () => {
      (prisma.deployment.findUnique as jest.Mock).mockResolvedValue(mockDeployment);
      (prisma.execution.findUnique as jest.Mock).mockResolvedValue(mockExecution);
      (clickUp.updateStatus as jest.Mock).mockRejectedValue('String Error Throw');

      await service.syncToClickUp('deployment-123');

      expect(prisma.ticket.update).toHaveBeenCalledWith({
        where: { id: 'ticket-001' },
        data: { pm_synced: false },
      });
      expect(auditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'pm_sync_failed',
          afterState: expect.objectContaining({
            errorCode: 'UNKNOWN_EXCEPTION',
          }),
        }),
      );
    });

    it('T-FC1: calls postActionableFailureComment on soft failure (updateStatus=false)', async () => {
      const integrationService = module.get(ProjectIntegrationService);
      const failureCommentService = module.get(PMActionableFailureCommentService);

      const mockIntegration = { id: 'int-1' } as any;
      (prisma.deployment.findUnique as jest.Mock).mockResolvedValue(mockDeployment);
      (prisma.execution.findUnique as jest.Mock).mockResolvedValue(mockExecution);
      (integrationService.findFirstByProject as jest.Mock).mockResolvedValue(mockIntegration);
      (clickUp.updateStatus as jest.Mock).mockResolvedValue(false);

      await service.syncToClickUp('deployment-123');

      expect(failureCommentService.postActionableFailureComment).toHaveBeenCalledWith(
        mockIntegration,
        'clickup-123',
        expect.objectContaining({
          targetStatus: 'Deployed',
          failureReason: 'ClickUp status update returned false — graceful degradation',
        }),
        expect.any(String),
      );
    });

    it('T-FC2: soft failure: context.targetStatus is "Deployed" for a COMPLETED deployment', async () => {
      const integrationService = module.get(ProjectIntegrationService);
      const failureCommentService = module.get(PMActionableFailureCommentService);

      const mockIntegration = { id: 'int-1' } as any;
      (prisma.deployment.findUnique as jest.Mock).mockResolvedValue(mockDeployment); // status: COMPLETED
      (prisma.execution.findUnique as jest.Mock).mockResolvedValue(mockExecution);
      (integrationService.findFirstByProject as jest.Mock).mockResolvedValue(mockIntegration);
      (clickUp.updateStatus as jest.Mock).mockResolvedValue(false);

      await service.syncToClickUp('deployment-123');

      expect(failureCommentService.postActionableFailureComment).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ targetStatus: 'Deployed' }),
        expect.any(String),
      );
    });

    it('T-FC4: exception path: calls postActionableFailureComment when outer catch fires AND ticketClickupId known AND integration non-null', async () => {
      const integrationService = module.get(ProjectIntegrationService);
      const failureCommentService = module.get(PMActionableFailureCommentService);

      const mockIntegration = { id: 'int-1' } as any;
      const networkError = new PMProviderClientError(504, 'TIMEOUT_504', {
        message: 'Upstream timeout',
      });

      (prisma.deployment.findUnique as jest.Mock).mockResolvedValue(mockDeployment);
      (prisma.execution.findUnique as jest.Mock).mockResolvedValue(mockExecution);
      (integrationService.findFirstByProject as jest.Mock).mockResolvedValue(mockIntegration);
      (clickUp.updateStatus as jest.Mock).mockRejectedValue(networkError);

      await service.syncToClickUp('deployment-123');

      expect(failureCommentService.postActionableFailureComment).toHaveBeenCalledWith(
        mockIntegration,
        'clickup-123',
        expect.objectContaining({
          targetStatus: 'Deployed',
          failureReason: 'PM provider returned 504: TIMEOUT_504',
          providerErrorCode: 'TIMEOUT_504',
          providerErrorBody: { message: 'Upstream timeout' },
        }),
        expect.any(String),
      );
    });

    it('T-FC3: soft failure: comment call throws → caught silently, method still returns without throwing', async () => {
      const failureCommentService = module.get(PMActionableFailureCommentService);
      (prisma.deployment.findUnique as jest.Mock).mockResolvedValue(mockDeployment);
      (prisma.execution.findUnique as jest.Mock).mockResolvedValue(mockExecution);
      (clickUp.updateStatus as jest.Mock).mockResolvedValue(false);

      (failureCommentService.postActionableFailureComment as jest.Mock).mockRejectedValue(
        new Error('Comment Service Error'),
      );

      await expect(service.syncToClickUp('deployment-123')).resolves.not.toThrow();
    });

    it('T-FC3-extra: passes missingFields from preCheckResult to failure comment (soft failure)', async () => {
      const integrationService = module.get(ProjectIntegrationService);
      const preCheckService = module.get(PMFieldPreCheckService);
      const failureCommentService = module.get(PMActionableFailureCommentService);

      const mockIntegration = { id: 'int-1' } as any;
      const missingFields = [{ id: 'f1', name: 'Points', type: 'NUMBER', required: true }] as any;

      (prisma.deployment.findUnique as jest.Mock).mockResolvedValue(mockDeployment);
      (prisma.execution.findUnique as jest.Mock).mockResolvedValue(mockExecution);
      (integrationService.findFirstByProject as jest.Mock).mockResolvedValue(mockIntegration);
      (preCheckService.checkRequiredFields as jest.Mock).mockResolvedValue({
        allFilled: false,
        missingFields,
      });
      (clickUp.updateStatus as jest.Mock).mockResolvedValue(false);

      await service.syncToClickUp('deployment-123');

      expect(failureCommentService.postActionableFailureComment).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ missingFields }),
        expect.any(String),
      );
    });

    it('T-FC5: exception path: comment skipped when ticketClickupId is undefined', async () => {
      const failureCommentService = module.get(PMActionableFailureCommentService);
      (prisma.deployment.findUnique as jest.Mock).mockResolvedValue(mockDeployment);
      // Execution return ticket with null clickup_task_id
      (prisma.execution.findUnique as jest.Mock).mockResolvedValue({
        ...mockExecution,
        ticket: { ...mockExecution.ticket, clickup_task_id: undefined },
      });
      (clickUp.updateStatus as jest.Mock).mockRejectedValue(new Error('Hard crash'));

      await service.syncToClickUp('deployment-123');

      expect(failureCommentService.postActionableFailureComment).not.toHaveBeenCalled();
    });

    it('T-FC6: exception path: comment skipped when integration is null', async () => {
      const integrationService = module.get(ProjectIntegrationService);
      const failureCommentService = module.get(PMActionableFailureCommentService);

      (prisma.deployment.findUnique as jest.Mock).mockResolvedValue(mockDeployment);
      (prisma.execution.findUnique as jest.Mock).mockResolvedValue(mockExecution);
      (integrationService.findFirstByProject as jest.Mock).mockResolvedValue(null);
      (clickUp.updateStatus as jest.Mock).mockRejectedValue(new Error('Hard crash'));

      await service.syncToClickUp('deployment-123');

      expect(failureCommentService.postActionableFailureComment).not.toHaveBeenCalled();
    });

    it('T-FC7: exception path with PMProviderClientError: providerErrorCode and providerErrorBody passed through', async () => {
      const integrationService = module.get(ProjectIntegrationService);
      const failureCommentService = module.get(PMActionableFailureCommentService);

      const mockIntegration = { id: 'int-1' } as any;
      const providerError = new PMProviderClientError(401, 'OAUTH_017', { err: 'Token expired' });

      (prisma.deployment.findUnique as jest.Mock).mockResolvedValue(mockDeployment);
      (prisma.execution.findUnique as jest.Mock).mockResolvedValue(mockExecution);
      (integrationService.findFirstByProject as jest.Mock).mockResolvedValue(mockIntegration);
      (clickUp.updateStatus as jest.Mock).mockRejectedValue(providerError);

      await service.syncToClickUp('deployment-123');

      expect(failureCommentService.postActionableFailureComment).toHaveBeenCalledWith(
        mockIntegration,
        'clickup-123',
        expect.objectContaining({
          providerErrorCode: 'OAUTH_017',
          providerErrorBody: { err: 'Token expired' },
          missingFields: [],
        }),
        expect.any(String),
      );
    });

    it('T-SE1: soft failure: realtimeService.emitToRole called with PM role and pm-sync-failed event', async () => {
      const mockIntegration = { id: 'int-1' } as any;
      (prisma.deployment.findUnique as jest.Mock).mockResolvedValue(mockDeployment);
      (prisma.execution.findUnique as jest.Mock).mockResolvedValue(mockExecution);
      (integrationService.findFirstByProject as jest.Mock).mockResolvedValue(mockIntegration);
      (preCheckService.checkRequiredFields as jest.Mock).mockResolvedValue({
        allFilled: false,
        missingFields: [],
      });
      (clickUp.updateStatus as jest.Mock).mockResolvedValue(false);

      await service.syncToClickUp('deployment-123');

      expect(realtimeService.emitToRole).toHaveBeenCalledWith(
        'PM',
        'pm-sync-failed',
        expect.objectContaining({
          ticketId: 'clickup-123',
          projectId: 'proj-123',
        }),
      );
    });

    it('T-SE2: soft failure: payload includes provider, reason and missingFields', async () => {
      const mockIntegration = { id: 'int-1' } as any;
      const missingFields = [{ name: 'Priority' }];
      (prisma.deployment.findUnique as jest.Mock).mockResolvedValue(mockDeployment);
      (prisma.execution.findUnique as jest.Mock).mockResolvedValue(mockExecution);
      (integrationService.findFirstByProject as jest.Mock).mockResolvedValue(mockIntegration);
      (preCheckService.checkRequiredFields as jest.Mock).mockResolvedValue({
        allFilled: false,
        missingFields,
      });
      (clickUp.updateStatus as jest.Mock).mockResolvedValue(false);

      await service.syncToClickUp('deployment-123');

      expect(realtimeService.emitToRole).toHaveBeenCalledWith(
        'PM',
        'pm-sync-failed',
        expect.objectContaining({
          provider: 'CLICKUP',
          reason: expect.stringContaining('graceful degradation'),
          missingFields,
        }),
      );
    });

    it('T-SE3: soft failure: emitToRole NOT called when ticketProjectId is undefined', async () => {
      const mockIntegration = { id: 'int-1' } as any;
      (prisma.deployment.findUnique as jest.Mock).mockResolvedValue(mockDeployment);
      (prisma.execution.findUnique as jest.Mock).mockResolvedValue({
        ...mockExecution,
        ticket: { ...mockExecution.ticket, project_id: undefined },
      });
      (integrationService.findFirstByProject as jest.Mock).mockResolvedValue(mockIntegration);
      (preCheckService.checkRequiredFields as jest.Mock).mockResolvedValue({
        allFilled: false,
        missingFields: [],
      });
      (clickUp.updateStatus as jest.Mock).mockResolvedValue(false);

      await service.syncToClickUp('deployment-123');

      expect(realtimeService.emitToRole).not.toHaveBeenCalled();
    });

    it('T-SE4: soft failure: emitToRole throws → caught silently', async () => {
      const mockIntegration = { id: 'int-1' } as any;
      (prisma.deployment.findUnique as jest.Mock).mockResolvedValue(mockDeployment);
      (prisma.execution.findUnique as jest.Mock).mockResolvedValue(mockExecution);
      (integrationService.findFirstByProject as jest.Mock).mockResolvedValue(mockIntegration);
      (preCheckService.checkRequiredFields as jest.Mock).mockResolvedValue({
        allFilled: false,
        missingFields: [],
      });
      (clickUp.updateStatus as jest.Mock).mockResolvedValue(false);
      (realtimeService.emitToRole as jest.Mock).mockImplementation(() => {
        throw new Error('Socket crash');
      });

      // Should not throw
      await expect(service.syncToClickUp('deployment-123')).resolves.not.toThrow();
    });

    it('T-SE5: exception path: emitToRole called when outer catch fires', async () => {
      (prisma.deployment.findUnique as jest.Mock).mockResolvedValue(mockDeployment);
      (prisma.execution.findUnique as jest.Mock).mockResolvedValue(mockExecution);
      (clickUp.updateStatus as jest.Mock).mockRejectedValue(new Error('Hard crash'));

      await service.syncToClickUp('deployment-123');

      expect(realtimeService.emitToRole).toHaveBeenCalledWith(
        'PM',
        'pm-sync-failed',
        expect.objectContaining({
          projectId: 'proj-123',
          reason: 'Hard crash',
          missingFields: [],
        }),
      );
    });

    it('T-SE6: exception path: emitToRole NOT called when ticketProjectId is undefined', async () => {
      (prisma.deployment.findUnique as jest.Mock).mockResolvedValue(mockDeployment);
      (prisma.execution.findUnique as jest.Mock).mockResolvedValue({
        ...mockExecution,
        ticket: { ...mockExecution.ticket, project_id: undefined },
      });
      (clickUp.updateStatus as jest.Mock).mockRejectedValue(new Error('Hard crash'));

      await service.syncToClickUp('deployment-123');

      expect(realtimeService.emitToRole).not.toHaveBeenCalled();
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
