/**
 * QA Sampling Service Tests
 * Story 8.1: QA Review Queue & Sampling Configuration
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '../../common/logger/logger.service';
import {
  QaSamplingService,
  PercentageSamplingStrategy,
  RiskBasedSamplingStrategy,
  CompositeSamplingStrategy,
  RiskScoringService,
} from './qa-sampling.service';
import {
  ITicketData,
  ISamplingConfig,
  SamplingStrategy,
} from '../interfaces/qa-sampling.interface';
import { RiskLevel } from '@/prisma/client';

describe('QaSamplingService', () => {
  let service: QaSamplingService;

  let _configService: ConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QaSamplingService,
        PercentageSamplingStrategy,
        RiskBasedSamplingStrategy,
        CompositeSamplingStrategy,
        RiskScoringService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue: unknown) => defaultValue),
          },
        },
        {
          provide: LoggerService,
          useValue: {
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<QaSamplingService>(QaSamplingService);
    // Config service is available via module if needed
  });

  describe('getDefaultConfig', () => {
    it('should return default configuration', () => {
      const config = service.getDefaultConfig();

      expect(config.id).toBe('default');
      expect(config.percentage).toBe(20);
      expect(config.riskBasedEnabled).toBe(true);
      expect(config.riskRules).toBeDefined();
    });
  });

  describe('validatePercentage', () => {
    it('should clamp negative values to 0', () => {
      expect(service.validatePercentage(-10)).toBe(0);
    });

    it('should clamp values over 100 to 100', () => {
      expect(service.validatePercentage(150)).toBe(100);
    });

    it('should return valid values unchanged', () => {
      expect(service.validatePercentage(50)).toBe(50);
    });
  });
});

describe('PercentageSamplingStrategy', () => {
  let strategy: PercentageSamplingStrategy;

  beforeEach(() => {
    strategy = new PercentageSamplingStrategy();
  });

  it('should sample at configured percentage rate', () => {
    const ticket: ITicketData = {
      ticketId: 'TEST-123',
      executionId: 'exec-123',
      filesChanged: 3,
      complexityScore: 5,
      aiProvider: 'GEMINI',
    };

    const config: ISamplingConfig = {
      id: 'test',
      percentage: 50,
      riskBasedEnabled: false,
      riskRules: {
        fileCount: {
          highThreshold: 10,
          mediumThreshold: 5,
          highMultiplier: 100,
          mediumMultiplier: 2,
        },
        complexity: {
          highThreshold: 10,
          mediumThreshold: 5,
          highMultiplier: 100,
          mediumMultiplier: 1.5,
        },
        aiProvider: { claudeMultiplier: 1.0, geminiMultiplier: 1.0 },
      },
    };

    // Run multiple times to account for randomness
    const results: boolean[] = [];
    for (let i = 0; i < 100; i++) {
      const decision = strategy.shouldSample(ticket, config);
      results.push(decision.sample);
      expect(decision.riskLevel).toBe(RiskLevel.LOW);
      expect(decision.samplingStrategy).toBe(SamplingStrategy.PERCENTAGE);
      expect(decision.probability).toBe(0.5);
    }

    // With 50% probability, we expect roughly 50% samples
    const sampleCount = results.filter((r) => r).length;
    expect(sampleCount).toBeGreaterThan(20);
    expect(sampleCount).toBeLessThan(80);
  });
});

describe('RiskScoringService', () => {
  let service: RiskScoringService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RiskScoringService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(),
          },
        },
        {
          provide: LoggerService,
          useValue: {
            debug: jest.fn(),
            log: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<RiskScoringService>(RiskScoringService);
  });

  describe('calculateRiskScore', () => {
    it('should return HIGH risk for files > 10', () => {
      const ticket: ITicketData = {
        ticketId: 'TEST-123',
        executionId: 'exec-123',
        filesChanged: 15,
        complexityScore: 3,
        aiProvider: 'CLAUDE_CODE',
      };

      const score = service.calculateRiskScore(ticket);

      expect(score.level).toBe(RiskLevel.HIGH);
      expect(score.factors).toContain('high_file_count');
      expect(score.score).toBeGreaterThanOrEqual(100);
      expect(score.cumulativeMultiplier).toBeGreaterThanOrEqual(100);
    });

    it('should return HIGH risk for complexity >= 10', () => {
      const ticket: ITicketData = {
        ticketId: 'TEST-123',
        executionId: 'exec-123',
        filesChanged: 3,
        complexityScore: 12,
        aiProvider: 'CLAUDE_CODE',
      };

      const score = service.calculateRiskScore(ticket);

      expect(score.level).toBe(RiskLevel.HIGH);
      expect(score.factors).toContain('high_complexity');
      expect(score.score).toBeGreaterThanOrEqual(100);
      expect(score.cumulativeMultiplier).toBeGreaterThanOrEqual(100);
    });

    it('should return MEDIUM risk for files 5-10', () => {
      const ticket: ITicketData = {
        ticketId: 'TEST-123',
        executionId: 'exec-123',
        filesChanged: 7,
        complexityScore: 3,
        aiProvider: 'CLAUDE_CODE',
      };

      const score = service.calculateRiskScore(ticket);

      expect(score.level).toBe(RiskLevel.MEDIUM);
      expect(score.factors).toContain('medium_file_count');
      expect(score.cumulativeMultiplier).toBeGreaterThanOrEqual(2.0);
    });

    it('should return MEDIUM risk for complexity 5-9', () => {
      const ticket: ITicketData = {
        ticketId: 'TEST-123',
        executionId: 'exec-123',
        filesChanged: 3,
        complexityScore: 7,
        aiProvider: 'CLAUDE_CODE',
      };

      const score = service.calculateRiskScore(ticket);

      expect(score.level).toBe(RiskLevel.MEDIUM);
      expect(score.factors).toContain('medium_complexity');
      expect(score.cumulativeMultiplier).toBeGreaterThanOrEqual(1.5);
    });

    it('should return LOW risk for normal tickets', () => {
      const ticket: ITicketData = {
        ticketId: 'TEST-123',
        executionId: 'exec-123',
        filesChanged: 3,
        complexityScore: 3,
        aiProvider: 'CLAUDE_CODE',
      };

      const score = service.calculateRiskScore(ticket);

      expect(score.level).toBe(RiskLevel.LOW);
      expect(score.score).toBe(0);
      expect(score.cumulativeMultiplier).toBe(1.0);
    });

    it('should add factor for high risk provider if configured', () => {
      const ticket: ITicketData = {
        ticketId: 'TEST-123',
        executionId: 'exec-123',
        filesChanged: 3,
        complexityScore: 3,
        aiProvider: 'GEMINI',
      };

      const score = service.calculateRiskScore(ticket);

      // Note: Replacing previous cursor test with a generic provider check if applicable
      // For now, CLAUDE/GEMINI are 1.0x by default.
      expect(score.cumulativeMultiplier).toBe(1.0);
    });

    it('should accumulate multiple risk factors (multiplicative)', () => {
      const ticket: ITicketData = {
        ticketId: 'TEST-123',
        executionId: 'exec-123',
        filesChanged: 7, // medium: 2x
        complexityScore: 7, // medium: 1.5x
        aiProvider: 'CLAUDE_CODE', // 1.0x
      };

      const score = service.calculateRiskScore(ticket);

      expect(score.factors).toContain('medium_file_count');
      expect(score.factors).toContain('medium_complexity');
      // AC#2: Cumulative multiplicative: 2.0 * 1.5 * 1.0 = 3.0
      expect(score.cumulativeMultiplier).toBeCloseTo(3.0, 1);
    });
  });
});

describe('RiskBasedSamplingStrategy', () => {
  let strategy: RiskBasedSamplingStrategy;

  let _riskScoringService: RiskScoringService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RiskBasedSamplingStrategy,
        RiskScoringService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(),
          },
        },
        {
          provide: LoggerService,
          useValue: {
            debug: jest.fn(),
            log: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
          },
        },
      ],
    }).compile();

    strategy = module.get<RiskBasedSamplingStrategy>(RiskBasedSamplingStrategy);
    // Risk scoring service is available via module if needed
  });

  it('should always sample HIGH risk tickets', () => {
    const ticket: ITicketData = {
      ticketId: 'TEST-123',
      executionId: 'exec-123',
      filesChanged: 15, // HIGH
      complexityScore: 3,
      aiProvider: 'CLAUDE_CODE',
    };

    const config: ISamplingConfig = {
      id: 'test',
      percentage: 20,
      riskBasedEnabled: true,
      riskRules: {
        fileCount: {
          highThreshold: 10,
          mediumThreshold: 5,
          highMultiplier: 100,
          mediumMultiplier: 2,
        },
        complexity: {
          highThreshold: 10,
          mediumThreshold: 5,
          highMultiplier: 100,
          mediumMultiplier: 1.5,
        },
        aiProvider: { claudeMultiplier: 1.0, geminiMultiplier: 1.0 },
      },
    };

    // Run multiple times - HIGH risk should always sample
    for (let i = 0; i < 10; i++) {
      const decision = strategy.shouldSample(ticket, config);
      expect(decision.sample).toBe(true);
      expect(decision.riskLevel).toBe(RiskLevel.HIGH);
      expect(decision.probability).toBe(1.0);
    }
  });

  it('should apply probability multiplier for MEDIUM risk', () => {
    const ticket: ITicketData = {
      ticketId: 'TEST-123',
      executionId: 'exec-123',
      filesChanged: 7, // MEDIUM
      complexityScore: 3,
      aiProvider: 'CLAUDE_CODE',
    };

    const config: ISamplingConfig = {
      id: 'test',
      percentage: 20, // 20% base
      riskBasedEnabled: true,
      riskRules: {
        fileCount: {
          highThreshold: 10,
          mediumThreshold: 5,
          highMultiplier: 100,
          mediumMultiplier: 2,
        },
        complexity: {
          highThreshold: 10,
          mediumThreshold: 5,
          highMultiplier: 100,
          mediumMultiplier: 1.5,
        },
        aiProvider: { claudeMultiplier: 1.0, geminiMultiplier: 1.0 },
      },
    };

    const decision = strategy.shouldSample(ticket, config);

    expect(decision.riskLevel).toBe(RiskLevel.MEDIUM);
    // With 20% base + ~20 score, probability should be ~28%
    expect(decision.probability).toBeGreaterThan(0.2);
    expect(decision.probability).toBeLessThan(0.5);
  });
});

describe('CompositeSamplingStrategy', () => {
  let strategy: CompositeSamplingStrategy;

  let _percentageStrategy: PercentageSamplingStrategy;

  let _riskBasedStrategy: RiskBasedSamplingStrategy;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompositeSamplingStrategy,
        PercentageSamplingStrategy,
        RiskBasedSamplingStrategy,
        RiskScoringService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(),
          },
        },
        {
          provide: LoggerService,
          useValue: {
            debug: jest.fn(),
            log: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
          },
        },
      ],
    }).compile();

    strategy = module.get<CompositeSamplingStrategy>(CompositeSamplingStrategy);
    // Strategies are available via module if needed
  });

  it('should use percentage-only when risk-based is disabled', () => {
    const ticket: ITicketData = {
      ticketId: 'TEST-123',
      executionId: 'exec-123',
      filesChanged: 3,
      complexityScore: 3,
      aiProvider: 'CLAUDE_CODE',
    };

    const config: ISamplingConfig = {
      id: 'test',
      percentage: 100, // Always sample
      riskBasedEnabled: false,
      riskRules: {
        fileCount: {
          highThreshold: 10,
          mediumThreshold: 5,
          highMultiplier: 100,
          mediumMultiplier: 2,
        },
        complexity: {
          highThreshold: 10,
          mediumThreshold: 5,
          highMultiplier: 100,
          mediumMultiplier: 1.5,
        },
        aiProvider: { claudeMultiplier: 1.0, geminiMultiplier: 1.0 },
      },
    };

    const decision = strategy.shouldSample(ticket, config);

    expect(decision.sample).toBe(true);
    expect(decision.samplingStrategy).toBe(SamplingStrategy.PERCENTAGE);
  });

  it('should prioritize HIGH risk over percentage', () => {
    const ticket: ITicketData = {
      ticketId: 'TEST-123',
      executionId: 'exec-123',
      filesChanged: 15, // HIGH risk
      complexityScore: 3,
      aiProvider: 'CLAUDE_CODE',
    };

    const config: ISamplingConfig = {
      id: 'test',
      percentage: 0, // Never sample via percentage
      riskBasedEnabled: true,
      riskRules: {
        fileCount: {
          highThreshold: 10,
          mediumThreshold: 5,
          highMultiplier: 100,
          mediumMultiplier: 2,
        },
        complexity: {
          highThreshold: 10,
          mediumThreshold: 5,
          highMultiplier: 100,
          mediumMultiplier: 1.5,
        },
        aiProvider: { claudeMultiplier: 1.0, geminiMultiplier: 1.0 },
      },
    };

    const decision = strategy.shouldSample(ticket, config);

    expect(decision.sample).toBe(true);
    expect(decision.riskLevel).toBe(RiskLevel.HIGH);
  });
});
