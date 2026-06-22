import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApprovalDecision, ExecutionStatus, TicketStatus } from '@/prisma/client';
import { AIDecisionLoggerService } from '@/audit/ai-decision-logger.service';
import { PrismaService } from '@/database/prisma.service';
import { GitHubService } from '@/github/github.service';
import { OpenHarnessRunnerService } from '@/openharness/openharness-runner.service';
import { OpenHarnessSkill } from '@/openharness/skills.enum';
import { RealtimeService } from '@/realtime/realtime.service';
import { ApprovalGateService } from './approval-gate.service';

describe('ApprovalGateService', () => {
  const execution = {
    id: 'exec-1',
    ticket_id: 'ticket-1',
    status: ExecutionStatus.AWAITING_APPROVAL,
    ticket: {
      id: 'ticket-1',
      clickup_task_id: 'cu-1',
      project_id: 'project-1',
      project: {
        id: 'project-1',
        gitHubAccount: { installationId: 'install-1' },
      },
    },
  };

  let prisma: {
    execution: { findUnique: jest.Mock; update: jest.Mock; findMany: jest.Mock };
    ticket: { update: jest.Mock };
    gitHubPush: { findFirst: jest.Mock };
    approvalRecord: { findFirst: jest.Mock; create: jest.Mock };
  };
  let github: { mergePullRequest: jest.Mock };
  let realtime: { emitToProject: jest.Mock; emitToRole: jest.Mock };
  let runner: { runForTicket: jest.Mock };
  let config: { get: jest.Mock };
  let logger: { logDecision: jest.Mock };
  let service: ApprovalGateService;

  beforeEach(() => {
    prisma = {
      execution: {
        findUnique: jest.fn().mockResolvedValue(execution),
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      },
      ticket: { update: jest.fn().mockResolvedValue({}) },
      gitHubPush: {
        findFirst: jest.fn().mockResolvedValue({
          repository: 'owner/repo',
          pr_number: 7,
          pr_url: 'https://github.com/owner/repo/pull/7',
        }),
      },
      approvalRecord: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'approval-1' }),
      },
    };
    github = { mergePullRequest: jest.fn().mockResolvedValue({ sha: 'sha-1' }) };
    realtime = { emitToProject: jest.fn(), emitToRole: jest.fn() };
    runner = { runForTicket: jest.fn().mockResolvedValue('exec-2') };
    config = {
      get: jest.fn((key: string) =>
        key === 'openharness.workspaceDir' ? '/workspaces/dsf' : undefined,
      ),
    };
    logger = { logDecision: jest.fn().mockResolvedValue({}) };
    service = new ApprovalGateService(
      prisma as never as PrismaService,
      github as never as GitHubService,
      realtime as never as RealtimeService,
      runner as never as OpenHarnessRunnerService,
      config as never as ConfigService,
      logger as never as AIDecisionLoggerService,
    );
  });

  it('opens the gate without merging', async () => {
    await service.openGate('exec-1', 'corr-1');

    expect(prisma.execution.update).toHaveBeenCalledWith({
      where: { id: 'exec-1' },
      data: { status: ExecutionStatus.AWAITING_APPROVAL, error_message: null },
    });
    expect(prisma.ticket.update).toHaveBeenCalledWith({
      where: { id: 'ticket-1' },
      data: { status: TicketStatus.AWAITING_APPROVAL },
    });
    expect(github.mergePullRequest).not.toHaveBeenCalled();
    expect(realtime.emitToProject).toHaveBeenCalledWith(
      'project-1',
      'execution.approval-required',
      expect.objectContaining({ prNumber: 7, correlationId: 'corr-1' }),
    );
  });

  it('refuses merge without approval', async () => {
    await expect(service.assertApproved('exec-1')).rejects.toThrow(BadRequestException);
  });

  it('approves once and merges the PR', async () => {
    prisma.approvalRecord.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'approval-1',
    });

    const result = await service.recordDecision({
      executionId: 'exec-1',
      deciderId: 'pm-1',
      decision: ApprovalDecision.APPROVE,
      reasoning: 'looks good',
    });

    expect(github.mergePullRequest).toHaveBeenCalledWith('owner', 'repo', 7, 'squash', 'install-1');
    expect(prisma.execution.update).toHaveBeenLastCalledWith({
      where: { id: 'exec-1' },
      data: { status: ExecutionStatus.COMPLETED, completed_at: expect.any(Date) },
    });
    expect(result).toEqual({
      status: ExecutionStatus.COMPLETED,
      decision: ApprovalDecision.APPROVE,
      prUrl: 'https://github.com/owner/repo/pull/7',
    });
  });

  it('rejects by re-dispatching implement without merging', async () => {
    const result = await service.recordDecision({
      executionId: 'exec-1',
      deciderId: 'pm-1',
      decision: ApprovalDecision.REWORK,
      reasoning: 'fix tests',
    });

    expect(github.mergePullRequest).not.toHaveBeenCalled();
    expect(runner.runForTicket).toHaveBeenCalledWith('ticket-1', {
      skill: OpenHarnessSkill.CLICKUP_DEV_IMPLEMENT,
      workspaceDir: '/workspaces/dsf',
    });
    expect(result).toEqual({
      status: ExecutionStatus.QA_FAILED,
      decision: ApprovalDecision.REWORK,
      newExecutionId: 'exec-2',
    });
  });
});
