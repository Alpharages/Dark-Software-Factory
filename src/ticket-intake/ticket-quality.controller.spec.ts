import { Test, TestingModule } from '@nestjs/testing';
import { TicketQualityController } from './ticket-quality.controller';
import { TicketQualityService } from './ticket-quality.service';
import { QualityScoreResponseDto, QuickScoreResponseDto } from './dto';
import { JwtAuthGuard, RolesGuard } from '../common/guards';
import { ThrottlerGuard } from '@nestjs/throttler';

describe('TicketQualityController', () => {
  let controller: TicketQualityController;
  let service: TicketQualityService;

  const mockQualityScoreResponse: QualityScoreResponseDto = {
    totalScore: 75,
    grade: 'good',
    gradeEmoji: '👍',
    gradeMessage: 'Good quality. Minor improvements could enhance clarity.',
    breakdown: {
      titleClarity: {
        category: 'titleClarity',
        score: 12,
        maxPoints: 15,
        percentage: 80,
        suggestions: [],
        details: 'Word count optimal; Has action verb',
      },
      descriptionCompleteness: {
        category: 'descriptionCompleteness',
        score: 20,
        maxPoints: 25,
        percentage: 80,
        suggestions: [],
        details: 'Good length; Explains reasoning',
      },
      acceptanceCriteria: {
        category: 'acceptanceCriteria',
        score: 25,
        maxPoints: 30,
        percentage: 83,
        suggestions: [],
        details: 'BDD format; 3 criteria',
      },
      contextDocuments: {
        category: 'contextDocuments',
        score: 6,
        maxPoints: 10,
        percentage: 60,
        suggestions: ['Attach more context documents'],
        details: '1 doc attached',
      },
      taskComplexity: {
        category: 'taskComplexity',
        score: 7,
        maxPoints: 10,
        percentage: 70,
        suggestions: [],
        details: 'Tags: auth, security',
      },
      prerequisites: {
        category: 'prerequisites',
        score: 5,
        maxPoints: 10,
        percentage: 50,
        suggestions: [],
        details: '1 prerequisite',
      },
    },
    topSuggestions: ['Attach more context documents'],
    meetsMinimumThreshold: true,
    scoredAt: '2025-12-03T19:00:00.000Z',
  };

  const mockQuickScoreResponse: QuickScoreResponseDto = {
    score: 75,
    grade: 'good',
  };

  const mockTicketRequest = {
    title: 'Implement user authentication for login endpoint',
    description: 'Add JWT-based authentication because users need secure login.',
    acceptanceCriteria: 'Given valid credentials When login Then JWT returned',
    tags: ['auth', 'security'],
    contextDocuments: ['auth-spec.md'],
    prerequisites: ['Story 1.5'],
  };

  const mockService = {
    calculateScoreEnhanced: jest.fn().mockResolvedValue(mockQualityScoreResponse),
    quickScore: jest.fn().mockResolvedValue(mockQuickScoreResponse),
    batchScoreEnhanced: jest.fn().mockResolvedValue([mockQualityScoreResponse]),
  };

  // Mock guards to bypass authentication and rate limiting in unit tests
  const mockGuard = { canActivate: jest.fn(() => true) };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TicketQualityController],
      providers: [
        { provide: TicketQualityService, useValue: mockService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockGuard)
      .overrideGuard(RolesGuard)
      .useValue(mockGuard)
      .overrideGuard(ThrottlerGuard)
      .useValue(mockGuard)
      .compile();

    controller = module.get<TicketQualityController>(TicketQualityController);
    service = module.get<TicketQualityService>(TicketQualityService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('checkQuality', () => {
    it('should return quality score response', async () => {
      const result = await controller.checkQuality(mockTicketRequest, 'test-corr');

      expect(result).toEqual(mockQualityScoreResponse);
      expect(service.calculateScoreEnhanced).toHaveBeenCalledWith(mockTicketRequest, 'test-corr');
    });

    it('should call service with correct parameters', async () => {
      await controller.checkQuality(mockTicketRequest, 'corr-123');

      expect(service.calculateScoreEnhanced).toHaveBeenCalledTimes(1);
      expect(service.calculateScoreEnhanced).toHaveBeenCalledWith(mockTicketRequest, 'corr-123');
    });
  });

  describe('quickCheck', () => {
    it('should return quick score response', async () => {
      const result = await controller.quickCheck(mockTicketRequest, 'test-corr');

      expect(result).toEqual(mockQuickScoreResponse);
      expect(service.quickScore).toHaveBeenCalledWith(mockTicketRequest, 'test-corr');
    });
  });

  describe('batchScore', () => {
    it('should return batch score response', async () => {
      const batchRequest = { tickets: [mockTicketRequest] };
      const result = await controller.batchScore(batchRequest, 'test-corr');

      expect(result.results).toHaveLength(1);
      expect(result.processedCount).toBe(1);
      expect(result.averageScore).toBe(75);
      expect(service.batchScoreEnhanced).toHaveBeenCalledWith(batchRequest.tickets, 'test-corr');
    });

    it('should calculate correct average score for multiple tickets', async () => {
      const mockResponses = [
        { ...mockQualityScoreResponse, totalScore: 80 },
        { ...mockQualityScoreResponse, totalScore: 60 },
      ];
      mockService.batchScoreEnhanced.mockResolvedValueOnce(mockResponses);

      const batchRequest = { tickets: [mockTicketRequest, mockTicketRequest] };
      const result = await controller.batchScore(batchRequest, 'test-corr');

      expect(result.processedCount).toBe(2);
      expect(result.averageScore).toBe(70); // (80 + 60) / 2
    });

    it('should handle empty results', async () => {
      mockService.batchScoreEnhanced.mockResolvedValueOnce([]);

      const batchRequest = { tickets: [] };
      const result = await controller.batchScore(batchRequest, 'test-corr');

      expect(result.processedCount).toBe(0);
      expect(result.averageScore).toBe(0);
    });
  });
});
