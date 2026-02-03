import { Test, TestingModule } from '@nestjs/testing';
import { ProductionApprovalService } from './production-approval.service';
import { PrismaService } from '../../database/prisma.service';
import { DeploymentOrchestrator } from '../../github/services/deployment-orchestrator.service';
import { ClickUpService } from '../../clickup/clickup.service';
import { AIDecisionLoggerService } from '../../audit/ai-decision-logger.service';
import { ApprovalDecision } from '../../prisma/client';

describe('ProductionApprovalService', () => {
  let service: ProductionApprovalService;
  let prisma: {
    ticket: { findUnique: jest.Mock; update: jest.Mock };
    execution: { findFirst: jest.Mock };
    productionApproval: { create: jest.Mock };
    gitHubPush: { findFirst: jest.Mock };
  };
  let deploymentOrchestrator: { triggerDeployment: jest.Mock };
  let clickUp: { updateStatus: jest.Mock; addComment: jest.Mock };
  let aiLogger: { logDecision: jest.Mock };

  beforeEach(async () => {
    prisma = {
      ticket: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      execution: {
        findFirst: jest.fn(),
      },
      productionApproval: {
        create: jest.fn(),
      },
      gitHubPush: {
        findFirst: jest.fn(),
      },
    };

    deploymentOrchestrator = {
      triggerDeployment: jest.fn().mockResolvedValue('deploy-1'),
    };

    clickUp = {
      updateStatus: jest.fn().mockResolvedValue(true),
      addComment: jest.fn().mockResolvedValue(true),
    };

    aiLogger = {
      logDecision: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductionApprovalService,
        { provide: PrismaService, useValue: prisma },
        { provide: DeploymentOrchestrator, useValue: deploymentOrchestrator },
        { provide: ClickUpService, useValue: clickUp },
        { provide: AIDecisionLoggerService, useValue: aiLogger },
      ],
    }).compile();

    service = module.get<ProductionApprovalService>(ProductionApprovalService);
  });

  describe('checkReadiness', () => {
    it('should return not ready if no execution/qa result found', async () => {
      prisma.ticket.findUnique.mockResolvedValue({ executions: [] });

      const result = await service.checkReadiness('ticket-1');
      expect(result.ready).toBe(false);
      expect(result.blockingReason).toContain('No QA result');
    });

    it('should return ready and passed if QA passed', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        executions: [
          {
            id: 'ex-1',
            qa_result: { id: 'qa-1', overall_passed: true },
          },
        ],
      });

      const result = await service.checkReadiness('ticket-1');
      expect(result.ready).toBe(true);
      expect(result.overallPassed).toBe(true);
    });

    it('should return ready but failed if QA failed', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        executions: [
          {
            id: 'ex-1',
            qa_result: { id: 'qa-1', overall_passed: false },
          },
        ],
      });

      const result = await service.checkReadiness('ticket-1');
      expect(result.ready).toBe(true);
      expect(result.overallPassed).toBe(false);
      expect(result.blockingReason).toContain('Quality Gates failed');
    });
  });

  describe('approveRelease', () => {
    it('should approve successfully when QA passed', async () => {
      prisma.ticket.findUnique.mockResolvedValueOnce({
        id: 'ticket-1',
        executions: [
          {
            id: 'ex-1',
            qa_result: { id: 'qa-1', overall_passed: true },
          },
        ],
      }); // Read for readiness

      prisma.ticket.findUnique.mockResolvedValueOnce({
        id: 'ticket-1',
        clickup_task_id: 'C123',
        executions: [{ id: 'ex-1' }],
      }); // Read for processing

      prisma.productionApproval.create.mockResolvedValue({ id: 'app-1' });
      prisma.gitHubPush.findFirst.mockResolvedValue({
        id: 'push-1',
        repository: 'checkReadiness/repo',
        branch_name: 'main',
        commit_sha: 'sha123',
      });

      await service.approveRelease('ticket-1', 'user-1');

      expect(prisma.productionApproval.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            decision: ApprovalDecision.APPROVE,
            approver_id: 'user-1',
          }),
        }),
      );
      expect(deploymentOrchestrator.triggerDeployment).toHaveBeenCalled();
      expect(clickUp.updateStatus).toHaveBeenCalledWith('C123', 'APPROVED');
    });

    it('should throw if QA failed and no override', async () => {
      prisma.ticket.findUnique.mockResolvedValueOnce({
        id: 'ticket-1',
        executions: [
          {
            id: 'ex-1',
            qa_result: { id: 'qa-1', overall_passed: false },
          },
        ],
      });

      await expect(service.approveRelease('ticket-1', 'user-1')).rejects.toThrow(
        'Cannot approve failed QA without override reason',
      );
    });

    it('should approve with override if QA failed but reason provided', async () => {
      prisma.ticket.findUnique.mockResolvedValueOnce({
        id: 'ticket-1',
        executions: [
          {
            id: 'ex-1',
            qa_result: { id: 'qa-1', overall_passed: false },
          },
        ],
      });

      prisma.ticket.findUnique.mockResolvedValueOnce({
        id: 'ticket-1',
        clickup_task_id: 'C123',
        executions: [{ id: 'ex-1' }],
      });

      prisma.productionApproval.create.mockResolvedValue({ id: 'app-1' });
      prisma.gitHubPush.findFirst.mockResolvedValue({
        id: 'push-1',
        repository: 'repo',
        branch_name: 'main',
        commit_sha: 'sha123',
      });

      await service.approveRelease('ticket-1', 'user-1', 'Emergency fix');

      expect(deploymentOrchestrator.triggerDeployment).toHaveBeenCalled();
      expect(prisma.productionApproval.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            override_reason: 'Emergency fix',
          }),
        }),
      );
    });
  });
});
