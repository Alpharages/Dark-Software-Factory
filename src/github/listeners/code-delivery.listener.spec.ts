import { CodeDeliveryListener } from './code-delivery.listener';
import { OpenHarnessCodeReadyEvent } from '@/openharness/events/openharness-code-ready.event';

describe('CodeDeliveryListener', () => {
  let eventBus: { on: jest.Mock };
  let prisma: { project: { findUnique: jest.Mock } };
  let config: { get: jest.Mock };
  let pushService: { pushExecutionBranch: jest.Mock };
  let prOrchestrator: { createPullRequest: jest.Mock };
  let listener: CodeDeliveryListener;

  const event = new OpenHarnessCodeReadyEvent(
    'exec-1',
    'ticket-1',
    'project-1',
    'ohp/86abc',
    '/clones/project-1',
    'https://github.com/acme/app.git',
    'clickup-dev-implement',
    'corr-1',
  );

  beforeEach(() => {
    eventBus = { on: jest.fn() };
    prisma = {
      project: { findUnique: jest.fn().mockResolvedValue({ require_pr_approval: null }) },
    };
    config = { get: jest.fn().mockReturnValue(true) };
    pushService = {
      pushExecutionBranch: jest.fn().mockResolvedValue({ pushed: true, commitSha: 'abc1234' }),
    };
    prOrchestrator = {
      createPullRequest: jest.fn().mockResolvedValue({ success: true, prNumber: 5 }),
    };
    listener = new CodeDeliveryListener(
      eventBus as never,
      prisma as never,
      config as never,
      pushService as never,
      prOrchestrator as never,
    );
  });

  it('subscribes to openharness.code-ready on init', () => {
    listener.onModuleInit();
    expect(eventBus.on).toHaveBeenCalledWith('openharness.code-ready', expect.any(Function));
  });

  it('pushes the branch but defers PR when approval is required (global default)', async () => {
    config.get.mockReturnValue(true);
    prisma.project.findUnique.mockResolvedValue({ require_pr_approval: null });

    await listener.handle(event);

    expect(pushService.pushExecutionBranch).toHaveBeenCalledWith({
      executionId: 'exec-1',
      projectId: 'project-1',
      repoDir: '/clones/project-1',
      branch: 'ohp/86abc',
      repositoryUrl: 'https://github.com/acme/app.git',
    });
    expect(prOrchestrator.createPullRequest).not.toHaveBeenCalled();
  });

  it('opens the PR immediately when approval is not required (global default)', async () => {
    config.get.mockReturnValue(false);
    prisma.project.findUnique.mockResolvedValue({ require_pr_approval: null });

    await listener.handle(event);

    expect(pushService.pushExecutionBranch).toHaveBeenCalled();
    expect(prOrchestrator.createPullRequest).toHaveBeenCalledWith('exec-1', 'corr-1');
  });

  it('lets a per-project override win over the global default', async () => {
    // Global says approval required, but project explicitly opts out → open PR.
    config.get.mockReturnValue(true);
    prisma.project.findUnique.mockResolvedValue({ require_pr_approval: false });

    await listener.handle(event);

    expect(prOrchestrator.createPullRequest).toHaveBeenCalledWith('exec-1', 'corr-1');
  });

  it('honours a per-project override that requires approval over a permissive global', async () => {
    config.get.mockReturnValue(false);
    prisma.project.findUnique.mockResolvedValue({ require_pr_approval: true });

    await listener.handle(event);

    expect(prOrchestrator.createPullRequest).not.toHaveBeenCalled();
  });

  it('does not open a PR when nothing was pushed', async () => {
    pushService.pushExecutionBranch.mockResolvedValue({
      pushed: false,
      skippedReason: 'no-commits',
    });

    await listener.handle(event);

    expect(prOrchestrator.createPullRequest).not.toHaveBeenCalled();
  });

  it('skips delivery when the event has no projectId', async () => {
    const noProject = { ...event, projectId: null } as OpenHarnessCodeReadyEvent;

    await listener.handle(noProject);

    expect(pushService.pushExecutionBranch).not.toHaveBeenCalled();
  });

  it('never throws when the push fails', async () => {
    pushService.pushExecutionBranch.mockRejectedValue(new Error('git push exploded'));

    await expect(listener.handle(event)).resolves.toBeUndefined();
    expect(prOrchestrator.createPullRequest).not.toHaveBeenCalled();
  });
});
