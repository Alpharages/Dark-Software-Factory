import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { GitHubService } from '@/github/github.service';
import { PMExecutionStatusService } from '@/integrations/pm-execution-status.service';
import { ExecutionTrackerService } from '@/execution/execution-tracker.service';
import { ExecutionStatus, GitHubStatus } from '@/prisma/client';
import { QAFailureResolutionService } from './qa-failure-resolution.service';
import { QaFailureResolutionAction } from '../dto/resolve-qa-failure.dto';

describe('QAFailureResolutionService', () => {
  let service: QAFailureResolutionService;
  let prisma: any;
  let githubService: any;
  let pmStatusService: any;
  let tracker: any;

  const mockExecution = {
    id: 'exec-1',
    status: ExecutionStatus.QA_FAILED,
    qa_failed_branch: 'feature/fix-bug',
    ticket: {
      id: 'ticket-1',
      title: 'Fix bug',
      clickup_task_id: 'cu-1',
      project: {
        id: 'proj-1',
        github_repository_url: 'https://github.com/owner/repo.git',
        default_branch: 'main',
        gitHubAccount: {
          installationId: 'inst-1',
        },
      },
    },
  };

  beforeEach(async () => {
    prisma = {
      execution: {
        findUnique: jest.fn(),
      },
      gitHubPush: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
    };

    githubService = {
      createPullRequest: jest.fn(),
      addLabelsToPR: jest.fn(),
    };

    pmStatusService = {
      notifyCodeReview: jest.fn(),
      notifyCancel: jest.fn(),
    };

    tracker = {
      updateStatus: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QAFailureResolutionService,
        { provide: PrismaService, useValue: prisma },
        { provide: GitHubService, useValue: githubService },
        { provide: PMExecutionStatusService, useValue: pmStatusService },
        { provide: ExecutionTrackerService, useValue: tracker },
      ],
    }).compile();

    service = module.get<QAFailureResolutionService>(QAFailureResolutionService);

    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('resolve', () => {
    it('throws NotFoundException if execution does not exist', async () => {
      prisma.execution.findUnique.mockResolvedValue(null);

      await expect(
        service.resolve('non-existent', { action: QaFailureResolutionAction.OPEN_PR }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException (409) if execution is not in QA_FAILED status', async () => {
      prisma.execution.findUnique.mockResolvedValue({
        ...mockExecution,
        status: ExecutionStatus.IN_PROGRESS,
      });

      await expect(
        service.resolve('exec-1', { action: QaFailureResolutionAction.OPEN_PR }),
      ).rejects.toThrow(ConflictException);
    });

    it('ConflictException message contains current state', async () => {
      prisma.execution.findUnique.mockResolvedValue({
        ...mockExecution,
        status: ExecutionStatus.COMPLETED,
      });

      await expect(
        service.resolve('exec-1', { action: QaFailureResolutionAction.OPEN_PR }),
      ).rejects.toThrow(/is not in QA_FAILED state — current state: COMPLETED/);
    });

    describe('OPEN_PR action', () => {
      it('creates PR, adds labels, notifies ClickUp, persists push record, updates status', async () => {
        prisma.execution.findUnique.mockResolvedValue(mockExecution);
        githubService.createPullRequest.mockResolvedValue({
          number: 123,
          html_url: 'https://github.com/owner/repo/pull/123',
        });

        const result = await service.resolve(
          'exec-1',
          { action: QaFailureResolutionAction.OPEN_PR },
          'corr-1',
        );

        expect(githubService.createPullRequest).toHaveBeenCalledWith(
          'owner',
          'repo',
          expect.stringContaining('QA Failed Review'),
          expect.stringContaining('cu-1'),
          'feature/fix-bug',
          'main',
          'inst-1',
        );

        expect(githubService.addLabelsToPR).toHaveBeenCalledWith(
          'owner',
          'repo',
          123,
          ['qa-failed', 'manual-intervention'],
          'inst-1',
        );

        // P7: ClickUp notified before status transition
        const notifyOrder = pmStatusService.notifyCodeReview.mock.invocationCallOrder[0];
        const statusOrder = tracker.updateStatus.mock.invocationCallOrder[0];
        expect(notifyOrder).toBeLessThan(statusOrder);

        expect(pmStatusService.notifyCodeReview).toHaveBeenCalledWith(
          'proj-1',
          'ticket-1',
          'https://github.com/owner/repo/pull/123',
          'corr-1',
        );

        // P6 + P12: pr_url saved, GitHubStatus enum used
        expect(prisma.gitHubPush.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            execution_id: 'exec-1',
            branch_name: 'feature/fix-bug',
            pr_number: 123,
            pr_url: 'https://github.com/owner/repo/pull/123',
            push_status: GitHubStatus.PR_CREATED,
          }),
        });

        expect(tracker.updateStatus).toHaveBeenCalledWith('exec-1', ExecutionStatus.COMPLETED);

        // P4: Returns result object (AC-1)
        expect(result).toEqual({
          action: QaFailureResolutionAction.OPEN_PR,
          prUrl: 'https://github.com/owner/repo/pull/123',
          prNumber: 123,
        });
      });

      it('throws UnprocessableEntityException (422) when qa_failed_branch is null', async () => {
        prisma.execution.findUnique.mockResolvedValue({
          ...mockExecution,
          qa_failed_branch: null,
        });

        await expect(
          service.resolve('exec-1', { action: QaFailureResolutionAction.OPEN_PR }),
        ).rejects.toThrow(UnprocessableEntityException);
      });

      it('UnprocessableEntityException message contains execution id', async () => {
        prisma.execution.findUnique.mockResolvedValue({
          ...mockExecution,
          qa_failed_branch: null,
        });

        await expect(
          service.resolve('exec-1', { action: QaFailureResolutionAction.OPEN_PR }),
        ).rejects.toThrow(/has no pushed branch — cannot open PR/);
      });

      it('throws ConflictException when PR already exists for this execution', async () => {
        prisma.execution.findUnique.mockResolvedValue(mockExecution);
        prisma.gitHubPush.findFirst.mockResolvedValue({
          pr_number: 99,
          push_status: GitHubStatus.PR_CREATED,
        });

        await expect(
          service.resolve('exec-1', { action: QaFailureResolutionAction.OPEN_PR }),
        ).rejects.toThrow(ConflictException);
      });

      it('throws UnprocessableEntityException for unparseable repo URL', async () => {
        prisma.execution.findUnique.mockResolvedValue({
          ...mockExecution,
          ticket: {
            ...mockExecution.ticket,
            project: {
              ...mockExecution.ticket.project,
              github_repository_url: 'not-a-valid-url',
            },
          },
        });

        await expect(
          service.resolve('exec-1', { action: QaFailureResolutionAction.OPEN_PR }),
        ).rejects.toThrow(UnprocessableEntityException);
      });

      it('parses owner/repo from owner/repo slug format', async () => {
        prisma.execution.findUnique.mockResolvedValue({
          ...mockExecution,
          ticket: {
            ...mockExecution.ticket,
            project: {
              ...mockExecution.ticket.project,
              github_repository_url: 'acme-org/my-repo',
            },
          },
        });
        githubService.createPullRequest.mockResolvedValue({
          number: 5,
          html_url: 'https://github.com/acme-org/my-repo/pull/5',
        });

        await service.resolve('exec-1', { action: QaFailureResolutionAction.OPEN_PR }, 'corr-slug');

        expect(githubService.createPullRequest).toHaveBeenCalledWith(
          'acme-org',
          'my-repo',
          expect.any(String),
          expect.any(String),
          'feature/fix-bug',
          'main',
          'inst-1',
        );
      });

      it('continues and warns if addLabelsToPR throws', async () => {
        prisma.execution.findUnique.mockResolvedValue(mockExecution);
        githubService.createPullRequest.mockResolvedValue({
          number: 7,
          html_url: 'https://github.com/owner/repo/pull/7',
        });
        githubService.addLabelsToPR.mockRejectedValue(new Error('GitHub 403'));

        const result = await service.resolve(
          'exec-1',
          { action: QaFailureResolutionAction.OPEN_PR },
          'corr-label-err',
        );

        expect(result.prNumber).toBe(7);
        expect(tracker.updateStatus).toHaveBeenCalledWith('exec-1', ExecutionStatus.COMPLETED);
      });
    });

    describe('CANCEL action', () => {
      it('notifies ClickUp before updating status, returns result object', async () => {
        prisma.execution.findUnique.mockResolvedValue(mockExecution);

        const result = await service.resolve(
          'exec-1',
          { action: QaFailureResolutionAction.CANCEL },
          'corr-1',
        );

        // P7: ClickUp notified before status transition
        const notifyOrder = pmStatusService.notifyCancel.mock.invocationCallOrder[0];
        const statusOrder = tracker.updateStatus.mock.invocationCallOrder[0];
        expect(notifyOrder).toBeLessThan(statusOrder);

        expect(pmStatusService.notifyCancel).toHaveBeenCalledWith('proj-1', 'ticket-1', 'corr-1');
        expect(tracker.updateStatus).toHaveBeenCalledWith('exec-1', ExecutionStatus.FAILED);
        expect(githubService.createPullRequest).not.toHaveBeenCalled();

        // P5: Returns result object (AC-4)
        expect(result).toEqual({
          action: QaFailureResolutionAction.CANCEL,
          branchName: 'feature/fix-bug',
        });
      });
    });
  });
});
