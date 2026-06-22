import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApprovalDecision, ExecutionStatus, TicketStatus } from '@/prisma/client';
import { AIDecisionLoggerService } from '@/audit/ai-decision-logger.service';
import { PrismaService } from '@/database/prisma.service';
import { DispatcherService } from '@/dispatcher/dispatcher.service';
import { GitHubService } from '@/github/github.service';
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
    execution: {
      findUnique: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      findMany: jest.Mock;
    };
    ticket: { update: jest.Mock };
    gitHubPush: { findFirst: jest.Mock };
    approvalRecord: { findFirst: jest.Mock; create: jest.Mock };
  };
  let github: { mergePullRequest: jest.Mock };
  let realtime: { emitToProject: jest.Mock; emitToRole: jest.Mock };
  let dispatcher: { redispatchImplement: jest.Mock };
  let config: { get: jest.Mock };
  let logger: { logDecision: jest.Mock };
  let service: ApprovalGateService;

  beforeEach(() => {
    prisma = {
      execution: {
        findUnique: jest.fn().mockResolvedValue(execution),
        update: jest.fn().mockResolvedValue({}),
        // Default: the atomic gate claim succeeds (one row flipped).
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
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
    dispatcher = {
      redispatchImplement: jest.fn().mockResolvedValue({
        dispatched: true,
        executionId: 'exec-2',
        skill: 'clickup-dev-implement',
      }),
    };
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
      dispatcher as never as DispatcherService,
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
    // findFirst: 1st = terminal-decision check (none), 2nd = assertApproved (found).
    prisma.approvalRecord.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'approval-1' });

    const result = await service.recordDecision({
      executionId: 'exec-1',
      deciderId: 'pm-1',
      decision: ApprovalDecision.APPROVE,
      reasoning: 'looks good',
    });

    // Atomic claim guards against double-merge (AC6).
    expect(prisma.execution.updateMany).toHaveBeenCalledWith({
      where: { id: 'exec-1', status: ExecutionStatus.AWAITING_APPROVAL },
      data: { status: ExecutionStatus.IN_PROGRESS },
    });
    expect(prisma.approvalRecord.create).toHaveBeenCalledTimes(1);
    expect(github.mergePullRequest).toHaveBeenCalledWith('owner', 'repo', 7, 'squash', 'install-1');
    expect(prisma.execution.update).toHaveBeenLastCalledWith({
      where: { id: 'exec-1' },
      data: {
        status: ExecutionStatus.COMPLETED,
        completed_at: expect.any(Date),
        error_message: null,
      },
    });
    expect(result).toEqual({
      status: ExecutionStatus.COMPLETED,
      decision: ApprovalDecision.APPROVE,
      prUrl: 'https://github.com/owner/repo/pull/7',
    });
  });

  it.each([ApprovalDecision.REWORK, ApprovalDecision.REJECT])(
    'loops back on %s by re-dispatching implement through the guarded dispatcher path',
    async (decision) => {
      const result = await service.recordDecision({
        executionId: 'exec-1',
        deciderId: 'pm-1',
        decision,
        reasoning: 'fix tests',
      });

      expect(github.mergePullRequest).not.toHaveBeenCalled();
      expect(dispatcher.redispatchImplement).toHaveBeenCalledWith('ticket-1', 'exec-1');
      expect(result).toEqual({
        status: ExecutionStatus.QA_FAILED,
        decision,
        newExecutionId: 'exec-2',
        redispatch: 'dispatched',
      });
    },
  );

  it('holds the gate open on ESCALATE — records + notifies, no merge or loop-back', async () => {
    const result = await service.recordDecision({
      executionId: 'exec-1',
      deciderId: 'pm-1',
      decision: ApprovalDecision.ESCALATE,
      reasoning: 'needs a second opinion',
    });

    // Non-terminal: a record is written and the decision event emitted, but the
    // gate is not claimed and neither side effect fires (QA-notes edge case).
    expect(prisma.approvalRecord.create).toHaveBeenCalledTimes(1);
    expect(prisma.execution.updateMany).not.toHaveBeenCalled();
    expect(github.mergePullRequest).not.toHaveBeenCalled();
    expect(dispatcher.redispatchImplement).not.toHaveBeenCalled();
    expect(realtime.emitToProject).toHaveBeenCalledWith(
      'project-1',
      'execution.approval-decision',
      expect.objectContaining({ decision: ApprovalDecision.ESCALATE }),
    );
    expect(result).toEqual({
      status: ExecutionStatus.AWAITING_APPROVAL,
      decision: ApprovalDecision.ESCALATE,
    });
  });

  it('refuses a non-terminal decision when the gate is no longer awaiting approval', async () => {
    prisma.execution.findUnique.mockResolvedValue({
      ...execution,
      status: ExecutionStatus.COMPLETED,
    });

    await expect(
      service.recordDecision({
        executionId: 'exec-1',
        deciderId: 'pm-1',
        decision: ApprovalDecision.ESCALATE,
      }),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.approvalRecord.create).not.toHaveBeenCalled();
  });

  it('rejects a second decision once a terminal decision exists (no double-merge)', async () => {
    prisma.execution.findUnique.mockResolvedValue({
      ...execution,
      status: ExecutionStatus.COMPLETED,
    });
    prisma.approvalRecord.findFirst.mockResolvedValue({
      id: 'approval-1',
      decision: ApprovalDecision.APPROVE,
    });

    await expect(
      service.recordDecision({
        executionId: 'exec-1',
        deciderId: 'pm-2',
        decision: ApprovalDecision.APPROVE,
      }),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.execution.updateMany).not.toHaveBeenCalled();
    expect(github.mergePullRequest).not.toHaveBeenCalled();
  });

  it('rejects a concurrent decision that loses the atomic claim race', async () => {
    // The competing request already flipped the row out of AWAITING_APPROVAL.
    prisma.execution.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.recordDecision({
        executionId: 'exec-1',
        deciderId: 'pm-1',
        decision: ApprovalDecision.APPROVE,
      }),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.approvalRecord.create).not.toHaveBeenCalled();
    expect(github.mergePullRequest).not.toHaveBeenCalled();
  });

  it('releases the gate and records the failure when the merge fails, allowing retry', async () => {
    prisma.approvalRecord.findFirst
      .mockResolvedValueOnce(null) // terminal-decision check
      .mockResolvedValueOnce({ id: 'approval-1' }); // assertApproved
    github.mergePullRequest.mockRejectedValueOnce(new Error('merge conflict'));

    await expect(
      service.recordDecision({
        executionId: 'exec-1',
        deciderId: 'pm-1',
        decision: ApprovalDecision.APPROVE,
      }),
    ).rejects.toThrow('merge conflict');

    // Gate reset to AWAITING_APPROVAL with the failure recorded (retryable).
    expect(prisma.execution.update).toHaveBeenLastCalledWith({
      where: { id: 'exec-1' },
      data: { status: ExecutionStatus.AWAITING_APPROVAL, error_message: 'merge conflict' },
    });
    expect(realtime.emitToProject).toHaveBeenCalledWith(
      'project-1',
      'execution.approval-decision-failed',
      expect.objectContaining({ error: 'merge conflict' }),
    );
  });

  it('retries a previously-approved merge without writing a second record', async () => {
    // Execution still awaiting (prior merge failed) but an APPROVE is on record.
    prisma.approvalRecord.findFirst.mockResolvedValue({
      id: 'approval-1',
      decision: ApprovalDecision.APPROVE,
    });

    const result = await service.recordDecision({
      executionId: 'exec-1',
      deciderId: 'pm-1',
      decision: ApprovalDecision.APPROVE,
    });

    expect(prisma.approvalRecord.create).not.toHaveBeenCalled();
    expect(github.mergePullRequest).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(ExecutionStatus.COMPLETED);
  });
});
