/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test, TestingModule } from '@nestjs/testing';
import { DeploymentStatusSync } from './deployment-status-sync.service';
import { PrismaService } from '../../database/prisma.service';
import { ClickUpService } from '../../clickup/clickup.service';
import { MetricsService } from '../../common/metrics/metrics.service';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { SentryService } from '../../common/sentry/sentry.service';
import { ConfigService } from '@nestjs/config';
import { DeploymentStatus } from '@/prisma/client';

describe('DeploymentStatusSync', () => {
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
      execution_id: 'exec-789',
      error_message: null,
    },
  };

  const mockExecution = {
    id: 'exec-789',
    ticket_id: 'ticket-001',
    ticket: {
      clickup_task_id: 'clickup-123',
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
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
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: any) => {
              const config: Record<string, any> = {
                CLICKUP_STATUS_DEPLOYED: 'Done',
                CLICKUP_STATUS_DEPLOY_FAILED: 'Deployment Failed',
                CLICKUP_STATUS_ROLLED_BACK: 'Rolled Back',
              };
              return config[key] ?? defaultValue;
            }),
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
        'Done',
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
      const deploymentNoRelation = { ...mockDeployment, github_push: null } as any;
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
  });

  describe('getClickUpStatusName', () => {
    it('should map COMPLETED to configured status', () => {
      const status = (service as any).getClickUpStatusName(
        DeploymentStatus.COMPLETED,
        'production',
      );
      expect(status).toBe('Done');
    });

    it('should map FAILED to configured status', () => {
      const status = (service as any).getClickUpStatusName(DeploymentStatus.FAILED, 'staging');
      expect(status).toBe('Deployment Failed');
    });

    it('should map ROLLED_BACK to configured status', () => {
      const status = (service as any).getClickUpStatusName(
        DeploymentStatus.ROLLED_BACK,
        'production',
      );
      expect(status).toBe('Rolled Back');
    });

    it('should return default for unknown status', () => {
      const status = (service as any).getClickUpStatusName('UNKNOWN' as DeploymentStatus, 'dev');
      expect(status).toBe('In Progress');
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
