import { Test, TestingModule } from '@nestjs/testing';
import { AdrService } from './adr.service';
import { EscalationDetectorService } from './escalation-detector.service';
import { ArchitectureReviewNotificationService } from './architecture-review-notification.service';
import { PrismaService } from '../database/prisma.service';
import { EventBusService } from '../common/event-bus.service';
import { ClickUpService } from '../clickup/clickup.service';
import { CreateAdrDto } from './dto/create-adr.dto';
import { AdrStatus } from '@/prisma/client';
import { AIDecisionLoggerService } from '../audit/ai-decision-logger.service';
import { PromptGeneratorService } from '../ai-routing/prompt-generator.service';
import { ConfigService } from '@nestjs/config';

import { RiskAssessmentService } from './risk-assessment.service';
import { ConstraintValidatorService } from './constraint-validator.service';

// Mock dependencies
const mockPrismaService = {
  adr: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    findFirst: jest.fn(),
  },
  ticket: {
    findUnique: jest.fn(),
  },
};

const mockClickUpService = {
  createTask: jest.fn().mockResolvedValue({ id: 'task-123' }),
  getTask: jest.fn(),
};

const mockEventBus = {
  emit: jest.fn(),
};

const mockAuditLogger = {
  logDecision: jest.fn(),
};

const mockConfigService = {
  get: jest.fn((key) => {
    if (key === 'CLICKUP_API_KEY') return 'mock-key';
    return null;
  }),
};

const mockPromptGenerator = {
  generatePrompt: jest.fn(),
};

const mockRiskService = {
  calculateRiskLevel: jest.fn().mockReturnValue('LOW'),
  calculateRiskScore: jest.fn().mockReturnValue(10),
};

const mockConstraintValidator = {
  validate: jest.fn().mockResolvedValue([]),
};

describe('Escalation Workflow E2E', () => {
  let adrService: AdrService;
  let _notificationService: ArchitectureReviewNotificationService;

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        AdrService,
        EscalationDetectorService,
        ArchitectureReviewNotificationService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: EventBusService, useValue: mockEventBus },
        { provide: ClickUpService, useValue: mockClickUpService },
        { provide: AIDecisionLoggerService, useValue: mockAuditLogger },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: PromptGeneratorService, useValue: mockPromptGenerator },
        { provide: RiskAssessmentService, useValue: mockRiskService },
        { provide: ConstraintValidatorService, useValue: mockConstraintValidator },
      ],
    }).compile();

    adrService = moduleRef.get<AdrService>(AdrService);
    _notificationService = moduleRef.get<ArchitectureReviewNotificationService>(
      ArchitectureReviewNotificationService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should detect low confidence, escalate, and notify ClickUp', async () => {
    // 1. Setup: ADR data with low confidence
    const createDto: CreateAdrDto = {
      title: 'Unsure Decision',
      context: 'Complex legacy code',
      decision: 'Rewrite everything?',
      ai_confidence: 0.5, // Low confidence
      alternatives: 'Keep as is',
      consequences: 'Unknown risks',
      ticket_id: 'ticket-123',
    };

    // Mock Prisma responses
    mockPrismaService.ticket.findUnique.mockResolvedValue({
      id: 'ticket-123',
      project: { clickup_list_id: 'list-456' },
    });

    // Create response
    const createdAdr = {
      id: 'adr-1',
      ...createDto,
      status: AdrStatus.PROPOSED,
      ticket: { clickup_task_id: 'task-999' }, // For notification context
    };
    mockPrismaService.adr.create.mockResolvedValue(createdAdr);
    mockPrismaService.adr.findUnique.mockResolvedValue(createdAdr);
    mockPrismaService.adr.update.mockResolvedValue({ ...createdAdr, status: AdrStatus.ESCALATED });

    // 2. Execution
    await adrService.create(createDto);

    // 3. Verification - Escalation Detection
    // Should call update to set status ESCALATED
    expect(mockPrismaService.adr.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'adr-1' },
        data: expect.objectContaining({ status: AdrStatus.ESCALATED }),
      }),
    );

    // 4. Verification - Event Emission (Blocking)
    expect(mockEventBus.emit).toHaveBeenCalledWith(
      'adr.escalated',
      expect.objectContaining({
        adrId: 'adr-1',
        reason: 'LOW_CONFIDENCE',
      }),
    );

    // 5. Verification - ClickUp Notification
    expect(mockClickUpService.createTask).toHaveBeenCalledWith(
      'list-456',
      expect.objectContaining({
        name: expect.stringContaining('[ESCALATION]'),
        priority: 1,
        tags: expect.arrayContaining(['architecture-escalation']),
      }),
    );
  });

  it('should process TL guidance and trigger retry', async () => {
    // 1. Setup: Escalated ADR
    const adrId = 'adr-1';
    const escalatedAdr = {
      id: adrId,
      status: AdrStatus.ESCALATED,
      created_at: new Date(Date.now() - 10000), // 10s ago
      ticket_id: 'ticket-123',
    };

    mockPrismaService.adr.findUnique.mockResolvedValue(escalatedAdr);
    mockPrismaService.adr.update.mockResolvedValue({
      ...escalatedAdr,
      status: AdrStatus.GUIDANCE_PROVIDED,
      tl_guidance: 'Use Strategy Pattern',
    });

    // 2. Execution - Provide Guidance
    await adrService.provideGuidance(adrId, {
      guidance: 'Use Strategy Pattern',
      apply_globally: false,
      update_thresholds: false,
    });

    // 3. Verification - Status Update
    expect(mockPrismaService.adr.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: adrId },
        data: expect.objectContaining({
          status: AdrStatus.GUIDANCE_PROVIDED,
          tl_guidance: 'Use Strategy Pattern',
        }),
      }),
    );

    // 4. Verification - Retry Trigger
    expect(mockEventBus.emit).toHaveBeenCalledWith(
      'adr.reviewed',
      expect.objectContaining({
        adrId: adrId,
        action: 'GUIDANCE_PROVIDED',
        notes: 'Use Strategy Pattern',
      }),
    );
  });
});
