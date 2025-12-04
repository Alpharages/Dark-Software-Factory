import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaService } from '../src/database/prisma.service';
import { QaAutomationModule } from '../src/qa-automation/qa-automation.module';
import { CoverageService } from '../src/qa-automation/coverage.service';
import { CoverageFileParser } from '../src/qa-automation/coverage-file.parser';
import { ITestResult, TestFramework } from '../src/qa-automation/interfaces/test-runner.interface';
import { ICoverageOptions } from '../src/qa-automation/interfaces/coverage.interface';
import configuration from '../src/config/configuration';

describe('Coverage Enforcement (E2E)', () => {
  let app: INestApplication;
  let coverageService: CoverageService;
  let prisma: PrismaService;

  const mockFileParser = {
    parseCoverageSummary: jest.fn(),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          load: [configuration],
          isGlobal: true,
        }),
        QaAutomationModule,
      ],
    })
      .overrideProvider(CoverageFileParser)
      .useValue(mockFileParser)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    coverageService = moduleFixture.get<CoverageService>(CoverageService);
    prisma = moduleFixture.get<PrismaService>(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    // Clean up database
    await prisma.coverageBaseline.deleteMany();
    await prisma.projectCoverageConfig.deleteMany();
    await prisma.auditLog.deleteMany();
  });

  it('should enforce global coverage threshold', async () => {
    const testResult: ITestResult = {
      passed: true,
      rawOutput: '',
      framework: TestFramework.JEST,
      totalTests: 10,
      passedCount: 10,
      failedCount: 0,
      skippedCount: 0,
      durationMs: 1000,
      suites: [],
      failedTests: [],
      coverage: {
        lines: 50, // Below default 80
        branches: 50,
        functions: 50,
        statements: 50,
      },
    };

    const options: ICoverageOptions = {
      executionId: 'e2e-exec-1',
      correlationId: 'e2e-corr-1',
      projectId: 'e2e-proj-1',
      workspacePath: '/tmp/workspace',
      baseBranch: 'main',
    };

    mockFileParser.parseCoverageSummary.mockResolvedValue({
      files: [],
      aggregate: testResult.coverage,
    });

    const result = await coverageService.analyzeCoverage(testResult, options);

    expect(result.passed).toBe(false);
    expect(result.threshold).toBe(80);
    expect(result.current.lines).toBe(50);
  });

  it('should respect project-specific threshold override', async () => {
    // Set project threshold to 40
    await prisma.projectCoverageConfig.create({
      data: {
        project_id: 'e2e-proj-2',
        threshold: 40,
      },
    });

    const testResult: ITestResult = {
      passed: true,
      rawOutput: '',
      framework: TestFramework.JEST,
      totalTests: 10,
      passedCount: 10,
      failedCount: 0,
      skippedCount: 0,
      durationMs: 1000,
      suites: [],
      failedTests: [],
      coverage: {
        lines: 50, // Above 40, below default 80
        branches: 50,
        functions: 50,
        statements: 50,
      },
    };

    const options: ICoverageOptions = {
      executionId: 'e2e-exec-2',
      correlationId: 'e2e-corr-2',
      projectId: 'e2e-proj-2',
      workspacePath: '/tmp/workspace',
      baseBranch: 'main',
    };

    mockFileParser.parseCoverageSummary.mockResolvedValue({
      files: [],
      aggregate: testResult.coverage,
    });

    const result = await coverageService.analyzeCoverage(testResult, options);

    expect(result.passed).toBe(true);
    expect(result.threshold).toBe(40);
  });

  it('should create and update baseline', async () => {
    const projectId = 'e2e-proj-3';

    // 1. Initial run (creates baseline implicitly if we implemented that logic,
    // but in our service we only read. Let's seed a baseline first to test delta)
    await prisma.coverageBaseline.create({
      data: {
        project_id: projectId,
        branch: 'main',
        lines: 80,
        branches: 80,
        functions: 80,
        statements: 80,
      },
    });

    const testResult: ITestResult = {
      passed: true,
      rawOutput: '',
      framework: TestFramework.JEST,
      totalTests: 10,
      passedCount: 10,
      failedCount: 0,
      skippedCount: 0,
      durationMs: 1000,
      suites: [],
      failedTests: [],
      coverage: {
        lines: 85, // +5
        branches: 85,
        functions: 85,
        statements: 85,
      },
    };

    const options: ICoverageOptions = {
      executionId: 'e2e-exec-3',
      correlationId: 'e2e-corr-3',
      projectId: projectId,
      workspacePath: '/tmp/workspace',
      baseBranch: 'main',
    };

    mockFileParser.parseCoverageSummary.mockResolvedValue({
      files: [],
      aggregate: testResult.coverage,
    });

    const result = await coverageService.analyzeCoverage(testResult, options);

    expect(result.delta.lines).toBe(5);
    expect(result.baseline).toBeDefined();
  });
});
