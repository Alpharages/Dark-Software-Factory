import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { PMProvider } from '@prisma/client';
import { PMExecutionStatusService, ExecutionPhase } from './pm-execution-status.service';
import { ProjectIntegrationService } from './project-integration.service';
import { PMProviderFactory } from './providers/pm-provider.factory';
import { PMFieldPreCheckService } from './pm-field-pre-check.service';
import { PMFieldAutoFillService } from './pm-field-auto-fill.service';
import { AgentSkillRunner } from '@/ai-routing/agent-skills/agent-skill-runner.service';
import { NormalizedStatusType } from './providers/dto/normalized-status.dto';
import { NormalizedFieldType } from './providers/dto/normalized-field.dto';
import { ProjectIntegration } from '@prisma/client';
import { PrismaService } from '@/database/prisma.service';

const mockIntegration: ProjectIntegration = {
  id: 'int-1',
  project_id: 'proj-1',
  provider: PMProvider.CLICKUP,
  workspace_id: 'ws-1',
  workspace_name: 'Acme',
  access_token: 'token-abc',
  refresh_token: null,
  token_expiry: null,
  bot_user_id: null,
  bot_username: null,
  webhook_secret: null,
  webhook_id: null,
  provider_config: {},
  polling_enabled: false,
  webhook_enabled: true,
  polling_interval_min: 5,
  polling_last_run_at: null,
  ai_trigger_status: null,
  created_at: new Date(),
  updated_at: new Date(),
};

const mockTask = {
  id: 'task-1',
  name: 'Implement login',
  description: null,
  status: { id: 's-open', name: 'Open', color: '#ccc', type: NormalizedStatusType.TODO },
  url: 'https://app.clickup.com/task/task-1',
  listId: 'list-1',
  dueDate: null, // no due date by default — lets skill see it's missing
  assignees: [], // no assignees by default
};

const mockStatuses = [
  { id: 's-open', name: 'Open', color: '#ccc', type: NormalizedStatusType.TODO },
  { id: 's-coding', name: 'Coding', color: '#00f', type: NormalizedStatusType.IN_PROGRESS },
  { id: 's-pr', name: 'PR Ready', color: '#0f0', type: NormalizedStatusType.IN_PROGRESS },
  { id: 's-done', name: 'Done', color: '#000', type: NormalizedStatusType.DONE },
  { id: 's-blocked', name: 'Blocked', color: '#f00', type: NormalizedStatusType.CANCELLED },
];

describe('PMExecutionStatusService', () => {
  let service: PMExecutionStatusService;
  let integrationService: jest.Mocked<ProjectIntegrationService>;
  let providerFactory: jest.Mocked<PMProviderFactory>;
  let fieldPreCheck: jest.Mocked<PMFieldPreCheckService>;
  let fieldAutoFill: jest.Mocked<PMFieldAutoFillService>;
  let skillRunner: jest.Mocked<AgentSkillRunner>;
  let prisma: { ticket: { findUnique: jest.Mock } };
  let mockProvider: {
    getTask: jest.Mock;
    getStatuses: jest.Mock;
    updateStatus: jest.Mock;
    prepareForTransition: jest.Mock;
    getSelf: jest.Mock;
  };

  beforeEach(async () => {
    mockProvider = {
      getTask: jest.fn().mockResolvedValue(mockTask),
      getStatuses: jest.fn().mockResolvedValue(mockStatuses),
      updateStatus: jest.fn().mockResolvedValue(undefined),
      prepareForTransition: jest.fn().mockResolvedValue(undefined),
      getSelf: jest
        .fn()
        .mockResolvedValue({ id: 'owner-99', name: 'Workspace Owner', email: 'owner@acme.com' }),
    };

    integrationService = {
      findByProjectAndProvider: jest.fn().mockResolvedValue(mockIntegration),
    } as any;

    providerFactory = {
      getProvider: jest.fn().mockResolvedValue(mockProvider),
    } as any;

    skillRunner = {
      run: jest.fn().mockResolvedValue({ value: 'Coding' }),
    } as any;

    fieldPreCheck = {
      checkRequiredFields: jest
        .fn()
        .mockResolvedValue({ allFilled: true, preCheckFailed: false, missingFields: [] }),
    } as any;

    fieldAutoFill = {
      fillFactualFields: jest.fn().mockResolvedValue({ filledFields: [], remainingFields: [] }),
      fillInferredFields: jest.fn().mockResolvedValue(undefined),
    } as any;

    prisma = {
      ticket: {
        findUnique: jest.fn().mockResolvedValue({
          clickup_task_id: '86ewke7gg',
          title: 'Implement login',
          description: 'Login page description',
        }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PMExecutionStatusService,
        { provide: ProjectIntegrationService, useValue: integrationService },
        { provide: PMProviderFactory, useValue: providerFactory },
        { provide: PMFieldPreCheckService, useValue: fieldPreCheck },
        { provide: PMFieldAutoFillService, useValue: fieldAutoFill },
        { provide: AgentSkillRunner, useValue: skillRunner },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<PMExecutionStatusService>(PMExecutionStatusService);

    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('updateByPhase — happy path', () => {
    it('looks up clickup_task_id from the tickets table using the internal ticket ID', async () => {
      await service.updateByPhase('proj-1', 'internal-uuid-123', ExecutionPhase.STARTED);

      expect(prisma.ticket.findUnique).toHaveBeenCalledWith({
        where: { id: 'internal-uuid-123' },
        select: { clickup_task_id: true, title: true, description: true },
      });
    });

    it('calls ClickUp API with the external clickup_task_id, not the internal UUID', async () => {
      await service.updateByPhase('proj-1', 'internal-uuid-123', ExecutionPhase.STARTED);

      expect(mockProvider.getTask).toHaveBeenCalledWith('86ewke7gg');
    });

    it('resolves the CLICKUP integration for the project', async () => {
      await service.updateByPhase('proj-1', 'task-1', ExecutionPhase.STARTED);

      expect(integrationService.findByProjectAndProvider).toHaveBeenCalledWith(
        'proj-1',
        PMProvider.CLICKUP,
      );
    });

    it('fetches the task and statuses, then runs the skill', async () => {
      await service.updateByPhase('proj-1', 'task-1', ExecutionPhase.STARTED, 'corr-1');

      expect(mockProvider.getTask).toHaveBeenCalledWith('86ewke7gg');
      expect(mockProvider.getStatuses).toHaveBeenCalledWith('list-1');
      expect(skillRunner.run).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'clickup_status_transition' }),
        expect.objectContaining({
          taskName: 'Implement login',
          currentStatus: 'Open',
          availableStatuses: ['Open', 'Coding', 'PR Ready', 'Done', 'Blocked'],
          phase: ExecutionPhase.STARTED,
          hasAssignee: false, // mockTask.assignees is []
          hasDueDate: false, // mockTask.dueDate is null
        }),
        'corr-1',
      );
    });

    it('applies the status chosen by the AI skill using the ClickUp external ID', async () => {
      skillRunner.run.mockResolvedValue({ value: 'Coding' });

      await service.updateByPhase('proj-1', 'task-1', ExecutionPhase.STARTED);

      expect(mockProvider.updateStatus).toHaveBeenCalledWith('86ewke7gg', 'Coding');
    });

    it('does case-insensitive match when skill returns differently cased status', async () => {
      skillRunner.run.mockResolvedValue({ value: 'pr ready' });

      await service.updateByPhase('proj-1', 'task-1', ExecutionPhase.COMPLETED);

      expect(mockProvider.updateStatus).toHaveBeenCalledWith('86ewke7gg', 'PR Ready');
    });
  });

  describe('updateByPhase — graceful degradation', () => {
    it('skips when internal ticket is not found in DB', async () => {
      prisma.ticket.findUnique.mockResolvedValue(null);

      await expect(
        service.updateByPhase('proj-1', 'task-1', ExecutionPhase.STARTED),
      ).resolves.toBeUndefined();

      expect(mockProvider.updateStatus).not.toHaveBeenCalled();
    });

    it('skips when ticket has no clickup_task_id', async () => {
      prisma.ticket.findUnique.mockResolvedValue({ clickup_task_id: null });

      await expect(
        service.updateByPhase('proj-1', 'task-1', ExecutionPhase.STARTED),
      ).resolves.toBeUndefined();

      expect(mockProvider.updateStatus).not.toHaveBeenCalled();
    });

    it('skips without throwing when no integration is found', async () => {
      integrationService.findByProjectAndProvider.mockResolvedValue(null);

      await expect(
        service.updateByPhase('proj-1', 'task-1', ExecutionPhase.STARTED),
      ).resolves.toBeUndefined();

      expect(mockProvider.updateStatus).not.toHaveBeenCalled();
    });

    it('skips when the task has no listId', async () => {
      mockProvider.getTask.mockResolvedValue({ ...mockTask, listId: '' });

      await expect(
        service.updateByPhase('proj-1', 'task-1', ExecutionPhase.STARTED),
      ).resolves.toBeUndefined();

      expect(mockProvider.getStatuses).not.toHaveBeenCalled();
      expect(mockProvider.updateStatus).not.toHaveBeenCalled();
    });

    it('skips when no statuses are returned for the list', async () => {
      mockProvider.getStatuses.mockResolvedValue([]);

      await expect(
        service.updateByPhase('proj-1', 'task-1', ExecutionPhase.STARTED),
      ).resolves.toBeUndefined();

      expect(skillRunner.run).not.toHaveBeenCalled();
      expect(mockProvider.updateStatus).not.toHaveBeenCalled();
    });

    it('skips when the skill runner returns null (LLM unavailable)', async () => {
      skillRunner.run.mockResolvedValue(null);

      await expect(
        service.updateByPhase('proj-1', 'task-1', ExecutionPhase.STARTED),
      ).resolves.toBeUndefined();

      expect(mockProvider.updateStatus).not.toHaveBeenCalled();
    });

    it('skips when skill returns a status name not in the ClickUp list (hallucination guard)', async () => {
      skillRunner.run.mockResolvedValue({ value: 'Imaginary Status' });

      await expect(
        service.updateByPhase('proj-1', 'task-1', ExecutionPhase.STARTED),
      ).resolves.toBeUndefined();

      expect(mockProvider.updateStatus).not.toHaveBeenCalled();
    });

    it('never throws when providerFactory throws (best-effort)', async () => {
      providerFactory.getProvider.mockRejectedValue(new Error('OAuth token expired'));

      await expect(
        service.updateByPhase('proj-1', 'task-1', ExecutionPhase.STARTED),
      ).resolves.toBeUndefined();
    });

    it('never throws when getTask throws', async () => {
      mockProvider.getTask.mockRejectedValue(new Error('ClickUp API 500'));

      await expect(
        service.updateByPhase('proj-1', 'task-1', ExecutionPhase.COMPLETED),
      ).resolves.toBeUndefined();
    });

    it('never throws when updateStatus throws', async () => {
      mockProvider.updateStatus.mockRejectedValue(new Error('ClickUp rate limit'));

      await expect(
        service.updateByPhase('proj-1', 'task-1', ExecutionPhase.STARTED),
      ).resolves.toBeUndefined();
    });
  });

  describe('CS2 required-field pipeline (Layer 1)', () => {
    it('runs the field pre-check before the skill', async () => {
      await service.updateByPhase('proj-1', 'task-1', ExecutionPhase.STARTED, 'corr-1');

      expect(fieldPreCheck.checkRequiredFields).toHaveBeenCalledWith(
        mockIntegration,
        '86ewke7gg',
        'list-1',
        'corr-1',
      );
      // skill must run AFTER pre-check
      expect(skillRunner.run).toHaveBeenCalled();
    });

    it('fills missing custom fields when pre-check finds them', async () => {
      const missingFields = [
        { id: 'f1', name: 'Priority', type: NormalizedFieldType.DROPDOWN, required: true },
      ];
      fieldPreCheck.checkRequiredFields.mockResolvedValue({
        allFilled: false,
        preCheckFailed: false,
        missingFields,
      });
      fieldAutoFill.fillFactualFields.mockResolvedValue({ filledFields: [], remainingFields: [] });

      await service.updateByPhase('proj-1', 'task-1', ExecutionPhase.STARTED, 'corr-1');

      expect(fieldAutoFill.fillFactualFields).toHaveBeenCalledWith(
        mockIntegration,
        '86ewke7gg',
        missingFields,
        {},
        'corr-1',
      );
      // No AI inference needed since factual fill resolved everything
      expect(fieldAutoFill.fillInferredFields).not.toHaveBeenCalled();
    });

    it('runs AI inference for fields that factual fill could not resolve', async () => {
      const missingFields = [
        { id: 'f2', name: 'Category', type: NormalizedFieldType.TEXT, required: true },
      ];
      fieldPreCheck.checkRequiredFields.mockResolvedValue({
        allFilled: false,
        preCheckFailed: false,
        missingFields,
      });
      fieldAutoFill.fillFactualFields.mockResolvedValue({
        filledFields: [],
        remainingFields: missingFields,
      });

      await service.updateByPhase('proj-1', 'task-1', ExecutionPhase.STARTED, 'corr-1');

      expect(fieldAutoFill.fillInferredFields).toHaveBeenCalledWith(
        mockIntegration,
        '86ewke7gg',
        missingFields,
        expect.objectContaining({
          ticketTitle: 'Implement login',
          ticketDescription: 'Login page description',
        }),
        'corr-1',
      );
    });

    it('skips fill when allFilled is true', async () => {
      fieldPreCheck.checkRequiredFields.mockResolvedValue({
        allFilled: true,
        preCheckFailed: false,
        missingFields: [],
      });

      await service.updateByPhase('proj-1', 'task-1', ExecutionPhase.STARTED);

      expect(fieldAutoFill.fillFactualFields).not.toHaveBeenCalled();
    });

    it('skips fill when preCheckFailed is true (API error)', async () => {
      fieldPreCheck.checkRequiredFields.mockResolvedValue({
        allFilled: false,
        preCheckFailed: true,
        missingFields: [],
      });

      await service.updateByPhase('proj-1', 'task-1', ExecutionPhase.STARTED);

      expect(fieldAutoFill.fillFactualFields).not.toHaveBeenCalled();
      // Status transition still happens
      expect(mockProvider.updateStatus).toHaveBeenCalled();
    });

    it('continues with status transition even when CS2 pipeline throws', async () => {
      fieldPreCheck.checkRequiredFields.mockRejectedValue(new Error('ClickUp API timeout'));

      await service.updateByPhase('proj-1', 'task-1', ExecutionPhase.STARTED);

      // Status transition must still be attempted
      expect(skillRunner.run).toHaveBeenCalled();
      expect(mockProvider.updateStatus).toHaveBeenCalled();
    });
  });

  describe('prepareForTransition — Layer 2 core field pre-conditions', () => {
    it('calls prepareForTransition when skill signals needsAssignee and integration has bot_user_id', async () => {
      const integrationWithBot = { ...mockIntegration, bot_user_id: 'bot-42' };
      integrationService.findByProjectAndProvider.mockResolvedValue(integrationWithBot);
      skillRunner.run.mockResolvedValue({
        value: 'Coding',
        reasoning: JSON.stringify({
          status: 'Coding',
          needsAssignee: true,
          needsDueDate: false,
          needsTimeEstimate: false,
        }),
      });

      await service.updateByPhase('proj-1', 'task-1', ExecutionPhase.STARTED);

      expect(mockProvider.prepareForTransition).toHaveBeenCalledWith(
        '86ewke7gg',
        expect.objectContaining({ assigneeId: 'bot-42' }),
      );
    });

    it('falls back to getSelf (workspace owner) when bot_user_id is null', async () => {
      skillRunner.run.mockResolvedValue({
        value: 'Coding',
        reasoning: JSON.stringify({
          status: 'Coding',
          needsAssignee: true,
          needsDueDate: false,
          needsTimeEstimate: false,
        }),
      });
      // mockIntegration.bot_user_id is null by default

      await service.updateByPhase('proj-1', 'task-1', ExecutionPhase.STARTED);

      expect(mockProvider.getSelf).toHaveBeenCalled();
      expect(mockProvider.prepareForTransition).toHaveBeenCalledWith(
        '86ewke7gg',
        expect.objectContaining({ assigneeId: 'owner-99' }),
      );
    });

    it('skips assignee when bot_user_id is null and getSelf fails', async () => {
      mockProvider.getSelf.mockRejectedValue(new Error('ClickUp API down'));
      skillRunner.run.mockResolvedValue({
        value: 'Coding',
        reasoning: JSON.stringify({
          status: 'Coding',
          needsAssignee: true,
          needsDueDate: false,
          needsTimeEstimate: false,
        }),
      });

      await service.updateByPhase('proj-1', 'task-1', ExecutionPhase.STARTED);

      expect(mockProvider.prepareForTransition).not.toHaveBeenCalled();
      // status transition still happens
      expect(mockProvider.updateStatus).toHaveBeenCalledWith('86ewke7gg', 'Coding');
    });

    it('sets due_date when skill signals needsDueDate', async () => {
      skillRunner.run.mockResolvedValue({
        value: 'Coding',
        reasoning: JSON.stringify({
          status: 'Coding',
          needsAssignee: false,
          needsDueDate: true,
          needsTimeEstimate: false,
        }),
      });

      await service.updateByPhase('proj-1', 'task-1', ExecutionPhase.STARTED);

      expect(mockProvider.prepareForTransition).toHaveBeenCalledWith(
        '86ewke7gg',
        expect.objectContaining({ dueDateMs: expect.any(Number) }),
      );
    });

    it('sets time_estimate when skill signals needsTimeEstimate', async () => {
      skillRunner.run.mockResolvedValue({
        value: 'Coding',
        reasoning: JSON.stringify({
          status: 'Coding',
          needsAssignee: false,
          needsDueDate: false,
          needsTimeEstimate: true,
        }),
      });

      await service.updateByPhase('proj-1', 'task-1', ExecutionPhase.STARTED);

      expect(mockProvider.prepareForTransition).toHaveBeenCalledWith(
        '86ewke7gg',
        expect.objectContaining({ timeEstimateMs: 2 * 60 * 60 * 1000 }),
      );
    });

    it('skips prepareForTransition when skill has no reasoning (fallback plain-text path)', async () => {
      skillRunner.run.mockResolvedValue({ value: 'Coding' }); // no reasoning

      await service.updateByPhase('proj-1', 'task-1', ExecutionPhase.STARTED);

      expect(mockProvider.prepareForTransition).not.toHaveBeenCalled();
      expect(mockProvider.updateStatus).toHaveBeenCalledWith('86ewke7gg', 'Coding');
    });

    it('skips prepareForTransition when no pre-conditions are needed', async () => {
      skillRunner.run.mockResolvedValue({
        value: 'Coding',
        reasoning: JSON.stringify({
          status: 'Coding',
          needsAssignee: false,
          needsDueDate: false,
          needsTimeEstimate: false,
        }),
      });

      await service.updateByPhase('proj-1', 'task-1', ExecutionPhase.STARTED);

      expect(mockProvider.prepareForTransition).not.toHaveBeenCalled();
    });
  });

  describe('ExecutionPhase enum', () => {
    it.each([
      [ExecutionPhase.STARTED, 'Coding'],
      [ExecutionPhase.COMPLETED, 'PR Ready'],
      [ExecutionPhase.FAILED, 'Blocked'],
    ])('passes phase %s to skill runner context', async (phase, skillChoice) => {
      skillRunner.run.mockResolvedValue({ value: skillChoice });

      await service.updateByPhase('proj-1', 'task-1', phase);

      expect(skillRunner.run).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ phase }),
        undefined,
      );
      expect(mockProvider.updateStatus).toHaveBeenCalledWith('86ewke7gg', skillChoice);
    });
  });
});
