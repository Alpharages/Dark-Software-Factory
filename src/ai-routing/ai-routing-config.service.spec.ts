import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AiRoutingConfigService, DEFAULT_AI_ROUTING } from './ai-routing-config.service';
import { PrismaService } from '@/database/prisma.service';
import { AIProvider } from '@prisma/client';

describe('AiRoutingConfigService', () => {
  let service: AiRoutingConfigService;
  let prisma: jest.Mocked<PrismaService>;

  const mockPrismaService = {
    aiRoutingConfig: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
    project: {
      findUnique: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AiRoutingConfigService, { provide: PrismaService, useValue: mockPrismaService }],
    }).compile();

    service = module.get<AiRoutingConfigService>(AiRoutingConfigService);
    prisma = module.get(PrismaService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('getEffectiveConfig', () => {
    it('returns hardcoded defaults when no DB rows exist', async () => {
      mockPrismaService.aiRoutingConfig.findFirst.mockResolvedValue(null);
      mockPrismaService.aiRoutingConfig.findUnique.mockResolvedValue(null);

      const config = await service.getEffectiveConfig('project-x');

      expect(config.complexityThresholdHigh).toBe(40);
      expect(config.complexityThresholdMedium).toBe(10);
      expect(config.tierLowPrimary).toBe(AIProvider.KIMI);
      expect(prisma.aiRoutingConfig.findFirst).toHaveBeenCalledTimes(1);
      expect(prisma.aiRoutingConfig.findUnique).toHaveBeenCalledTimes(1);
    });

    it('merges global row values over hardcoded defaults', async () => {
      mockPrismaService.aiRoutingConfig.findFirst.mockResolvedValue({
        complexityThresholdHigh: 15,
        tierLowPrimary: AIProvider.GEMINI,
      });
      mockPrismaService.aiRoutingConfig.findUnique.mockResolvedValue(null);

      const config = await service.getEffectiveConfig('project-x');

      expect(config.complexityThresholdHigh).toBe(15);
      expect(config.tierLowPrimary).toBe(AIProvider.GEMINI);
      expect(config.complexityThresholdMedium).toBe(10); // unchanged default
    });

    it('merges project row values over global and defaults', async () => {
      mockPrismaService.aiRoutingConfig.findFirst.mockResolvedValue({
        complexityThresholdHigh: 15,
        tierLowPrimary: AIProvider.GEMINI,
      });
      mockPrismaService.aiRoutingConfig.findUnique.mockResolvedValue({
        projectId: 'project-x',
        complexityThresholdHigh: 20,
        tierLowPrimary: AIProvider.CLAUDE_CODE,
      });

      const config = await service.getEffectiveConfig('project-x');

      expect(config.complexityThresholdHigh).toBe(20);
      expect(config.tierLowPrimary).toBe(AIProvider.CLAUDE_CODE);
      expect(config.complexityThresholdMedium).toBe(10); // falls back to default
    });

    it('skips null fields in project row (inherits from global/defaults)', async () => {
      mockPrismaService.aiRoutingConfig.findFirst.mockResolvedValue({
        complexityThresholdHigh: 15,
        tierHighPrimary: AIProvider.GEMINI,
      });
      mockPrismaService.aiRoutingConfig.findUnique.mockResolvedValue({
        projectId: 'project-x',
        complexityThresholdHigh: null, // explicitly null — inherit from global
        tierLowPrimary: AIProvider.CLAUDE_CODE,
      });

      const config = await service.getEffectiveConfig('project-x');

      expect(config.complexityThresholdHigh).toBe(15); // null in project row → global value wins
      expect(config.tierLowPrimary).toBe(AIProvider.CLAUDE_CODE); // project override applied
      expect(config.tierHighPrimary).toBe(AIProvider.GEMINI); // from global
    });

    it('returns defaults without querying project row when no projectId is given', async () => {
      mockPrismaService.aiRoutingConfig.findFirst.mockResolvedValue(null);

      const config = await service.getEffectiveConfig();

      expect(prisma.aiRoutingConfig.findUnique).not.toHaveBeenCalled();
      expect(config).toEqual(DEFAULT_AI_ROUTING);
    });
  });

  describe('upsertGlobalConfig', () => {
    it('calls prisma.upsert with projectId null', async () => {
      mockPrismaService.aiRoutingConfig.upsert.mockResolvedValue({});

      await service.upsertGlobalConfig('user-123', {
        complexityThresholdMedium: 8,
        complexityThresholdHigh: 20,
      });

      expect(prisma.aiRoutingConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ projectId: null, updatedById: 'user-123' }),
          update: expect.objectContaining({ updatedById: 'user-123' }),
        }),
      );
    });
  });

  describe('upsertProjectConfig', () => {
    it('calls prisma.upsert with the correct projectId', async () => {
      mockPrismaService.project.findUnique.mockResolvedValue({ id: 'project-x' });
      mockPrismaService.aiRoutingConfig.upsert.mockResolvedValue({});

      const dto = {
        complexityThresholdMedium: 8,
        complexityThresholdHigh: 20,
        tierHighPrimary: AIProvider.GEMINI,
      };

      await service.upsertProjectConfig('project-x', 'user-123', dto);

      expect(prisma.aiRoutingConfig.upsert).toHaveBeenCalledWith({
        where: { projectId: 'project-x' },
        update: { ...dto, updatedById: 'user-123' },
        create: { ...dto, projectId: 'project-x', updatedById: 'user-123' },
      });
    });

    it('throws NotFoundException if project does not exist', async () => {
      mockPrismaService.project.findUnique.mockResolvedValue(null);

      await expect(service.upsertProjectConfig('no-such-project', 'user-123', {})).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('deleteProjectConfig', () => {
    it('calls deleteMany (idempotent — no throw if row absent)', async () => {
      mockPrismaService.aiRoutingConfig.deleteMany.mockResolvedValue({ count: 0 });

      await service.deleteProjectConfig('project-x');

      expect(prisma.aiRoutingConfig.deleteMany).toHaveBeenCalledWith({
        where: { projectId: 'project-x' },
      });
    });
  });

  describe('threshold cross-validation', () => {
    it('throws BadRequestException when high <= medium (both provided)', async () => {
      await expect(
        service.upsertGlobalConfig('user-123', {
          complexityThresholdMedium: 20,
          complexityThresholdHigh: 10, // high < medium
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when high equals medium', async () => {
      await expect(
        service.upsertGlobalConfig('user-123', {
          complexityThresholdMedium: 15,
          complexityThresholdHigh: 15,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('resolves other threshold from effective config when only one is provided', async () => {
      mockPrismaService.aiRoutingConfig.findFirst.mockResolvedValue(null);
      mockPrismaService.aiRoutingConfig.findUnique.mockResolvedValue(null);
      mockPrismaService.aiRoutingConfig.upsert.mockResolvedValue({});

      // Default medium=10, providing high=5 → 5 <= 10 → should throw
      await expect(
        service.upsertGlobalConfig('user-123', { complexityThresholdHigh: 5 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts valid threshold combination', async () => {
      mockPrismaService.aiRoutingConfig.upsert.mockResolvedValue({});

      await expect(
        service.upsertGlobalConfig('user-123', {
          complexityThresholdMedium: 10,
          complexityThresholdHigh: 40,
        }),
      ).resolves.not.toThrow();
    });
  });
});
