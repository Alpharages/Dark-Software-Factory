/**
 * GitHub Error Monitor Service Unit Tests
 * Story 4.7: GitHub Push Error Handling & Rollback
 *
 * Tests AC#1-5: Error classification, Sentry, PM notifications, rollback, graceful degradation
 */

import { Test, TestingModule } from '@nestjs/testing';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import {
  GitHubErrorMonitor,
  GitHubErrorContext,
  DeploymentFailureContext,
} from './github-error-monitor.service';
import { PrismaService } from '../../database/prisma.service';
import { SentryService } from '../../common/sentry/sentry.service';
import { MetricsService } from '../../common/metrics/metrics.service';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { ClickUpService } from '../../clickup/clickup.service';
import { LoggerService } from '../../common/logger/logger.service';

describe('GitHubErrorMonitor', () => {
  let service: GitHubErrorMonitor;
  let mockPrisma: Partial<PrismaService>;
  let mockSentry: Partial<SentryService>;
  let mockMetrics: Partial<MetricsService>;
  let mockAudit: Partial<AuditLogService>;
  let mockClickup: Partial<ClickUpService>;
  let mockLogger: { info: jest.Mock; error: jest.Mock; warn: jest.Mock };

  beforeEach(async () => {
    mockPrisma = {
      execution: {
        update: jest.fn().mockResolvedValue({}),
      } as unknown as PrismaService['execution'],
      deployment: {
        update: jest.fn().mockResolvedValue({}),
      } as unknown as PrismaService['deployment'],
    };

    mockSentry = {
      captureException: jest.fn(),
      captureMessage: jest.fn(),
    };

    mockMetrics = {
      incrementGitHubOperation: jest.fn(),
      incrementGitHubRateLimitHit: jest.fn(),
      incrementErrors: jest.fn(),
      recordDeployment: jest.fn(),
      recordDeploymentRollback: jest.fn(),
    };

    mockAudit = {
      log: jest.fn().mockResolvedValue({}),
    };

    mockClickup = {
      addComment: jest.fn().mockResolvedValue(true),
    };

    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GitHubErrorMonitor,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: SentryService, useValue: mockSentry },
        { provide: MetricsService, useValue: mockMetrics },
        { provide: AuditLogService, useValue: mockAudit },
        { provide: ClickUpService, useValue: mockClickup },
        {
          provide: LoggerService,
          useValue: { warn: jest.fn(), error: jest.fn(), log: jest.fn(), debug: jest.fn() },
        },
        { provide: WINSTON_MODULE_PROVIDER, useValue: mockLogger },
      ],
    }).compile();

    service = module.get<GitHubErrorMonitor>(GitHubErrorMonitor);
  });

  describe('handleGitHubError', () => {
    const baseContext: GitHubErrorContext = {
      operation: 'commit',
      executionId: 'exec-123',
      ticketId: 'ticket-456',
      repository: 'org/repo',
      branchName: 'feature/test',
      error: new Error('Bad credentials'),
      correlationId: 'corr-789',
      aiProvider: 'CURSOR',
    };

    it('should classify error and log to Sentry (AC#1)', async () => {
      await service.handleGitHubError(baseContext);

      expect(mockSentry.captureException).toHaveBeenCalledWith(
        baseContext.error,
        expect.objectContaining({
          tags: expect.objectContaining({
            operation: 'commit',
            error_type: 'auth_failure',
            repository: 'org/repo',
          }),
          extra: expect.objectContaining({
            executionId: 'exec-123',
            ticketId: 'ticket-456',
          }),
        }),
      );
    });

    it('should record Prometheus metrics (AC#4)', async () => {
      await service.handleGitHubError(baseContext);

      expect(mockMetrics.incrementGitHubOperation).toHaveBeenCalledWith('commit', 'error');
      expect(mockMetrics.incrementErrors).toHaveBeenCalledWith('github_commit_auth_failure');
    });

    it('should create audit log entry (AC#4)', async () => {
      await service.handleGitHubError(baseContext);

      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'github_error_detected',
          entityType: 'execution',
          entityId: 'exec-123',
        }),
      );
    });

    it('should notify PM via ClickUp (AC#2)', async () => {
      await service.handleGitHubError(baseContext);

      expect(mockClickup.addComment).toHaveBeenCalledWith(
        'ticket-456',
        expect.stringContaining('⚠️ **GitHub Operation Failed**'),
        expect.objectContaining({ correlationId: 'corr-789' }),
      );
    });

    it('should update execution status (AC#5)', async () => {
      await service.handleGitHubError(baseContext);

      expect(mockPrisma.execution?.update).toHaveBeenCalledWith({
        where: { id: 'exec-123' },
        data: expect.objectContaining({
          status: 'FAILED',
        }),
      });
    });

    it('should handle ClickUp failure gracefully (AC#5)', async () => {
      (mockClickup.addComment as jest.Mock).mockResolvedValue(false);

      await service.handleGitHubError(baseContext);

      // Should log notification failure
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'pm_notification_failed',
        }),
      );
      expect(mockSentry.captureMessage).toHaveBeenCalledWith(
        'PM notification delivery failed',
        'error', // ErrorSeverity.CRITICAL
        expect.anything(),
      );
    });

    it('should handle rate limit error specially (AC#1)', async () => {
      const rateLimitContext = { ...baseContext, error: new Error('API rate limit exceeded') };

      await service.handleGitHubError(rateLimitContext);

      expect(mockMetrics.incrementGitHubRateLimitHit).toHaveBeenCalled();
    });
  });

  describe('handleDeploymentFailure', () => {
    const rollbackContext: DeploymentFailureContext = {
      deploymentId: 'deploy-123',
      status: 'ROLLED_BACK',
      environment: 'production',
      ticketId: 'ticket-456',
      repository: 'org/repo',
      branchName: 'main',
      errorMessage: 'Health check failed',
      buildId: '42',
      cicdBuildUrl: 'https://github.com/org/repo/actions/runs/12345',
      correlationId: 'corr-789',
    };

    it('should update deployment status (AC#3)', async () => {
      await service.handleDeploymentFailure(rollbackContext);

      expect(mockPrisma.deployment?.update).toHaveBeenCalledWith({
        where: { id: 'deploy-123' },
        data: expect.objectContaining({
          status: 'ROLLED_BACK',
        }),
      });
    });

    it('should record rollback metrics (AC#4)', async () => {
      await service.handleDeploymentFailure(rollbackContext);

      expect(mockMetrics.recordDeployment).toHaveBeenCalledWith(
        expect.objectContaining({
          environment: 'production',
          status: 'rolled_back',
        }),
      );
    });

    it('should create rollback audit log (AC#3)', async () => {
      await service.handleDeploymentFailure(rollbackContext);

      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'deployment_rollback',
          entityType: 'deployment',
          entityId: 'deploy-123',
        }),
      );
    });

    it('should send rollback notification to PM (AC#3)', async () => {
      await service.handleDeploymentFailure(rollbackContext);

      expect(mockClickup.addComment).toHaveBeenCalledWith(
        'ticket-456',
        expect.stringContaining('🔄 **Deployment Rolled Back**'),
        expect.anything(),
      );
    });

    it('should handle FAILED status differently from ROLLED_BACK', async () => {
      const failedContext = { ...rollbackContext, status: 'FAILED' as const };

      await service.handleDeploymentFailure(failedContext);

      expect(mockClickup.addComment).toHaveBeenCalledWith(
        'ticket-456',
        expect.stringContaining('⚠️ **GitHub Operation Failed**'),
        expect.anything(),
      );
    });
  });
});
