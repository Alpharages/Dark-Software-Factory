import { Test, TestingModule } from '@nestjs/testing';
import { EscalationDetectorService } from './escalation-detector.service';
import { PrismaService } from '../database/prisma.service';

describe('Escalation DetectorService', () => {
  let service: EscalationDetectorService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EscalationDetectorService,
        {
          provide: PrismaService,
          useValue: {
            project: {
              findUnique: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<EscalationDetectorService>(EscalationDetectorService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('shouldEscalate', () => {
    it('should escalate when AI confidence is below threshold', () => {
      const result = service.shouldEscalate({
        aiConfidence: 0.65,
        aiResponse: 'Some decision text',
      });

      expect(result.shouldEscalate).toBe(true);
      expect(result.reason).toContain('LOW_CONFIDENCE');
    });

    it('should NOT escalate when AI confidence is above threshold', () => {
      const result = service.shouldEscalate({
        aiConfidence: 0.85,
        aiResponse: 'Clear decision with high confidence',
      });

      expect(result.shouldEscalate).toBe(false);
    });

    it('should use custom threshold when provided', async () => {
      jest.spyOn(prisma.project, 'findUnique').mockResolvedValue({
        id: 'project-1',
        escalation_threshold: 0.8,
      } as any);

      const threshold = await service.getEscalationThreshold('project-1');
      expect(threshold).toBe(0.8);
    });

    it('should escalate when multiple valid approaches are mentioned', () => {
      const aiResponse = `
                We could go with approach 1 using Redis,
                or alternatively approach 2 with PostgreSQL sessions,
                or even approach 3 with JWT tokens.
            `;

      const result = service.shouldEscalate({
        aiConfidence: 0.75,
        aiResponse,
      });

      expect(result.shouldEscalate).toBe(true);
      expect(result.reason).toContain('MULTIPLE_VALID_APPROACHES');
    });

    it('should escalate when uncertainty phrases are detected', () => {
      const aiResponse =
        'I am unsure which approach would be better. It depends on the specific requirements.';

      const result = service.shouldEscalate({
        aiConfidence: 0.72,
        aiResponse,
      });

      expect(result.shouldEscalate).toBe(true);
    });

    it('should escalate for security concerns', () => {
      const aiResponse = 'This decision involves authentication security implications.';

      const result = service.shouldEscalate({
        aiConfidence: 0.75,
        aiResponse,
        context: 'User authentication module',
      });

      expect(result.shouldEscalate).toBe(true);
      expect(result.reason).toContain('SECURITY_CONCERN');
    });

    it('should escalate when conflicting requirements detected', () => {
      const result = service.shouldEscalate({
        aiConfidence: 0.73,
        aiResponse:
          'The requirements conflict: we need high performance but also strict validation.',
        context: 'API design with conflicting performance and validation needs',
      });

      expect(result.shouldEscalate).toBe(true);
      expect(result.reason).toContain('CONFLICTING_REQUIREMENTS');
    });
  });

  describe('extractMetadata', () => {
    it('should extract alternatives from AI response', () => {
      const aiResponse = `
                Alternative 1: Use Redis for session storage
                Alternative 2: Use PostgreSQL with session table
                Alternative 3: Use JWT tokens (stateless)
            `;

      const metadata = service.extractMetadata(aiResponse, 'Session storage decision');

      expect(metadata.alternatives).toHaveLength(3);
      expect(metadata.alternatives[0]).toContain('Redis');
    });

    it('should extract questions from uncertain response', () => {
      const aiResponse = `
                What is the acceptable session lookup latency?
                Are we planning horizontal scaling soon?
            `;

      const metadata = service.extractMetadata(aiResponse, 'Session storage');

      expect(metadata.questions).toHaveLength(2);
      expect(metadata.questions[0]).toContain('latency');
    });

    it('should extract trade-offs from decision context', () => {
      const aiResponse = `
                Pros of Redis: Fast, scalable
                Cons of Redis: Additional infrastructure, complexity
                
                Pros of PostgreSQL: Already in use, simpler
                Cons of PostgreSQL: Slower for high concurrency
            `;

      const metadata = service.extractMetadata(aiResponse, 'Session storage');

      expect(metadata.tradeOffs).toBeDefined();
      expect(Object.keys(metadata.tradeOffs).length).toBeGreaterThan(0);
    });
  });

  describe('categorizeReason', () => {
    it('should categorize as LOW_CONFIDENCE when confidence is below threshold', () => {
      const category = service.categorizeReason({
        aiConfidence: 0.6,
        aiResponse: 'Some decision',
      });

      expect(category).toBe('LOW_CONFIDENCE');
    });

    it('should categorize as MISSING_CONTEXT when context is insufficient', () => {
      const aiResponse = 'Cannot determine without more information about system architecture.';

      const category = service.categorizeReason({
        aiConfidence: 0.7,
        aiResponse,
      });

      expect(category).toBe('MISSING_CONTEXT');
    });

    it('should categorize as PERFORMANCE_TRADEOFF when performance is mentioned', () => {
      const aiResponse = 'This decision has significant performance implications and trade-offs.';

      const category = service.categorizeReason({
        aiConfidence: 0.72,
        aiResponse,
      });

      expect(category).toBe('PERFORMANCE_TRADEOFF');
    });
  });
});
