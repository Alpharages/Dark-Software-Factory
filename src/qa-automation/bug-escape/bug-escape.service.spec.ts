import { Test, TestingModule } from '@nestjs/testing';
import { BugEscapeService } from './bug-escape.service';
import { PrismaService } from '@/database/prisma.service';
import { BugEscapeAnalyzer } from './bug-escape-analyzer.service';
import { QualityTrendsQueryDto } from './dto/quality-trends-query.dto';
import { QaMetricsService } from '../qa-metrics.service';
import { AIDecisionLoggerService } from '../../audit/ai-decision-logger.service';
import { LoggerService } from '../../common/logger/logger.service';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { EscapeCategory } from '@/prisma/client';

const mockPrismaService = {
  bugEscape: {
    create: jest.fn(),
    count: jest.fn(),
    findMany: jest.fn(),
    groupBy: jest.fn(),
    findUnique: jest.fn(),
  },
  deployment: {
    count: jest.fn(),
  },
  productionError: {
    findUnique: jest.fn(),
  },
  ticket: {
    findUnique: jest.fn(),
    count: jest.fn(),
  },
  execution: {
    findUnique: jest.fn(),
  },
  qAResult: {
    findUnique: jest.fn(),
  },
  qaReviewQueue: {
    findUnique: jest.fn(),
  },
};

const mockBugEscapeAnalyzer = {
  determineEscapeCategory: jest.fn(),
};

const mockQaMetricsService = {
  recordBugEscape: jest.fn(),
  updateEscapeRate: jest.fn(),
};

const mockAIDecisionLoggerService = {
  logDecision: jest.fn(),
};

const mockLoggerService = {
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
};

const mockCacheManager = {
  get: jest.fn(),
  set: jest.fn(),
};

describe('BugEscapeService', () => {
  let service: BugEscapeService;
  let prisma: typeof mockPrismaService;
  let analyzer: typeof mockBugEscapeAnalyzer;
  let metrics: typeof mockQaMetricsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BugEscapeService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: BugEscapeAnalyzer, useValue: mockBugEscapeAnalyzer },
        { provide: QaMetricsService, useValue: mockQaMetricsService },
        { provide: AIDecisionLoggerService, useValue: mockAIDecisionLoggerService },
        { provide: LoggerService, useValue: mockLoggerService },
        { provide: CACHE_MANAGER, useValue: mockCacheManager },
      ],
    }).compile();

    service = module.get<BugEscapeService>(BugEscapeService);
    prisma = module.get(PrismaService);
    analyzer = module.get(BugEscapeAnalyzer);
    metrics = module.get(QaMetricsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createEscape', () => {
    it('should create a bug escape and record metrics', async () => {
      const productionErrorId = 'err-123';
      const ticketId = 'ticket-123';
      const category = EscapeCategory.TEST_GAP;
      const expectedEscape = {
        id: 'esc-1',
        production_error_id: productionErrorId,
        ticket_id: ticketId,
        escape_category: category,
        project_id: 'proj-1',
      };

      prisma.productionError.findUnique.mockResolvedValue({ id: productionErrorId });
      analyzer.determineEscapeCategory.mockReturnValue(category);
      prisma.bugEscape.create.mockResolvedValue(expectedEscape);

      const result = await service.createEscape(productionErrorId, ticketId, null, null);

      expect(analyzer.determineEscapeCategory).toHaveBeenCalledWith(
        expect.objectContaining({ id: productionErrorId }),
        null,
        null,
      );
      expect(prisma.bugEscape.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          production_error_id: productionErrorId,
          ticket_id: ticketId,
          escape_category: category,
        }),
      });
      expect(metrics.recordBugEscape).toHaveBeenCalledWith(category, 'proj-1', undefined);
      expect(result).toEqual(expectedEscape);
    });
  });

  describe('calculateEscapeRate', () => {
    it('should return cached result if available', async () => {
      const query = { project_id: 'proj-1' };
      const cached = { summary: { escape_rate_percent: 5.5 }, period: '30d' };
      mockCacheManager.get.mockResolvedValue(cached);

      const result = await service.calculateEscapeRate(query);

      expect(mockCacheManager.get).toHaveBeenCalled();
      expect(prisma.bugEscape.count).not.toHaveBeenCalled();
      expect(result).toEqual(cached);
    });

    it('should calculate rate and update metric', async () => {
      const query = { project_id: 'proj-1', days: 30 };
      mockCacheManager.get.mockResolvedValue(null);
      prisma.bugEscape.count.mockResolvedValue(5);
      // It seems service uses ticket.count or deployment.count depending on implementation.
      // Based on code, it uses ticket.count.
      prisma.ticket.count.mockResolvedValue(100);

      const result = await service.calculateEscapeRate(query);

      expect(prisma.bugEscape.count).toHaveBeenCalled();
      expect(prisma.ticket.count).toHaveBeenCalled();
      expect(result.summary.escape_rate_percent).toBe(5.0); // 5/100 * 100
      expect(metrics.updateEscapeRate).toHaveBeenCalledWith('proj-1', 5.0);
      expect(mockCacheManager.set).toHaveBeenCalled();
    });
  });

  describe('getQualityTrends', () => {
    it('should return trend data', async () => {
      const query = { metric: 'escape_rate', granularity: 'week' };

      const result = await service.getQualityTrends(query as unknown as QualityTrendsQueryDto);

      expect(result.metric).toBe('escape_rate');
      expect(result.data.length).toBeGreaterThan(0);
    });
  });

  describe('compareProviders', () => {
    it('should compare providers', async () => {
      const escapes = [
        { ai_provider: 'CURSOR_HEADLESS', _count: { id: 10 } },
        { ai_provider: 'CLAUDE_CODE', _count: { id: 5 } },
      ];
      prisma.bugEscape.groupBy.mockResolvedValue(escapes);

      const result = await service.compareProviders('proj-1');

      expect(prisma.bugEscape.groupBy).toHaveBeenCalled();
      expect(result).toHaveLength(2);
      expect(result[0].provider).toBe('CURSOR_HEADLESS');
      expect(result[0].escapes).toBe(10);
    });
  });
});
