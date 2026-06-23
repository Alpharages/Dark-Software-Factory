import { Test, TestingModule } from '@nestjs/testing';
import { PMProvider } from '@prisma/client';
import { PMExecutionStatusService, ExecutionPhase } from './pm-execution-status.service';
import { ProjectIntegrationService } from './project-integration.service';
import { PMProviderFactory } from './providers/pm-provider.factory';
import { PMFieldPreCheckService } from './pm-field-pre-check.service';
import { PMFieldAutoFillService } from './pm-field-auto-fill.service';
import { PrismaService } from '@/database/prisma.service';

describe('PMExecutionStatusService', () => {
  let service: PMExecutionStatusService;
  const provider = {
    getTask: jest.fn(),
    getStatuses: jest.fn(),
    updateStatus: jest.fn(),
    addComment: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    provider.getTask.mockResolvedValue({
      id: 'task-1',
      name: 'Implement login',
      status: { name: 'Open' },
      listId: 'list-1',
    });
    provider.getStatuses.mockResolvedValue([
      { name: 'Coding' },
      { name: 'PR Ready' },
      { name: 'Blocked' },
    ]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PMExecutionStatusService,
        {
          provide: ProjectIntegrationService,
          useValue: {
            findByProjectAndProvider: jest.fn().mockResolvedValue({
              id: 'int-1',
              provider: PMProvider.CLICKUP,
            }),
          },
        },
        {
          provide: PMProviderFactory,
          useValue: { getProvider: jest.fn().mockResolvedValue(provider) },
        },
        {
          provide: PMFieldPreCheckService,
          useValue: {
            checkRequiredFields: jest
              .fn()
              .mockResolvedValue({ allFilled: true, preCheckFailed: false, missingFields: [] }),
          },
        },
        {
          provide: PMFieldAutoFillService,
          useValue: {
            fillFactualFields: jest
              .fn()
              .mockResolvedValue({ filledFields: [], remainingFields: [] }),
            fillInferredFields: jest.fn(),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            ticket: {
              findUnique: jest.fn().mockResolvedValue({
                clickup_task_id: '86abc123',
                title: 'Implement login',
                description: 'Build login',
              }),
            },
            project: { findUnique: jest.fn() },
          },
        },
      ],
    }).compile();

    service = module.get(PMExecutionStatusService);
  });

  it.each([
    [ExecutionPhase.STARTED, 'Coding'],
    [ExecutionPhase.COMPLETED, 'PR Ready'],
    [ExecutionPhase.FAILED, 'Blocked'],
    [ExecutionPhase.QA_FAILED, 'Blocked'],
  ])('maps %s to %s without ai-routing skills', async (phase, status) => {
    await service.updateByPhase('proj-1', 'ticket-1', phase);

    expect(provider.updateStatus).toHaveBeenCalledWith('86abc123', status);
  });
});
