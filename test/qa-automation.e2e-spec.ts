import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { TestRunnerService } from '../src/qa-automation/test-runner.service';
import { DockerExecutorService } from '../src/qa-automation/docker-executor.service';
import { PrismaService } from '../src/database/prisma.service';
import { QaAutomationModule } from '../src/qa-automation/qa-automation.module';
import { TestFramework } from '../src/qa-automation/interfaces';
import { ConfigModule } from '@nestjs/config';
import configuration from '../src/config/configuration';
import * as fs from 'fs/promises';

jest.mock('fs/promises');

describe('QA Automation E2E', () => {
  let app: INestApplication;
  let testRunner: TestRunnerService;
  let prisma: PrismaService;

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
      .overrideProvider(DockerExecutorService)
      .useValue({
        isDockerAvailable: jest.fn().mockResolvedValue(true),
        ensureImage: jest.fn().mockResolvedValue(undefined),
        executeInContainer: jest.fn().mockResolvedValue({
          exitCode: 0,
          stdout: '',
          stderr: '',
          timedOut: false,
          durationMs: 1500,
        }),
      })
      .overrideProvider(PrismaService)
      .useValue({
        qAResult: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({ id: 'qa-1' }),
          update: jest.fn().mockResolvedValue({ id: 'qa-1' }),
        },
        auditLog: {
          create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
        },
        execution: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'exec-1',
            ticket_id: 'ticket-1',
          }),
        },
        ticket: {
          update: jest.fn().mockResolvedValue({ id: 'ticket-1' }),
        },
      })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    testRunner = moduleFixture.get<TestRunnerService>(TestRunnerService);
    prisma = moduleFixture.get<PrismaService>(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('TestRunnerService E2E', () => {
    it('should detect and run tests with mocked Docker', async () => {
      // Mock filesystem for framework detection
      // Mock filesystem for framework detection
      (fs.readFile as jest.Mock).mockResolvedValue(
        JSON.stringify({
          numTotalTests: 5,
          numPassedTests: 5,
          numFailedTests: 0,
          testResults: [],
        }),
      );

      const result = await testRunner.runTests({
        workspacePath: '/test/sample-project',
        executionId: 'exec-e2e-1',
        correlationId: 'corr-e2e-1',
        framework: TestFramework.JEST,
      });

      expect(result.passed).toBe(true);
      expect(result.totalTests).toBe(5);
    });

    it('should save results to database', async () => {
      (fs.readFile as jest.Mock).mockResolvedValue(
        JSON.stringify({
          numTotalTests: 10,
          numPassedTests: 8,
          numFailedTests: 2,
          testResults: [],
        }),
      );

      const result = await testRunner.runTests({
        workspacePath: '/test/project',
        executionId: 'exec-e2e-2',
        correlationId: 'corr-e2e-2',
        framework: TestFramework.JEST,
      });

      await testRunner.saveTestResult('exec-e2e-2', result, 'corr-e2e-2');

      expect(prisma.qAResult.create).toHaveBeenCalled();
    });

    it('should create audit log entry', async () => {
      (fs.readFile as jest.Mock).mockResolvedValue(
        JSON.stringify({
          numTotalTests: 5,
          numPassedTests: 5,
          numFailedTests: 0,
          testResults: [],
        }),
      );

      const result = await testRunner.runTests({
        workspacePath: '/test/project',
        executionId: 'exec-e2e-3',
        correlationId: 'corr-e2e-3',
        framework: TestFramework.JEST,
      });

      await testRunner.saveTestResult('exec-e2e-3', result, 'corr-e2e-3');

      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            entity_type: 'execution',
            action: 'tests_executed',
          }),
        }),
      );
    });

    it('should update ticket status on failure', async () => {
      (fs.readFile as jest.Mock).mockResolvedValue(
        JSON.stringify({
          numTotalTests: 10,
          numPassedTests: 5,
          numFailedTests: 5,
          testResults: [
            {
              name: 'test.spec.ts',
              startTime: 1000,
              endTime: 2000,
              assertionResults: [
                {
                  title: 'failed test',
                  status: 'failed',
                  duration: 100,
                  failureMessages: ['Test failed'],
                },
              ],
            },
          ],
        }),
      );

      const result = await testRunner.runTests({
        workspacePath: '/test/project',
        executionId: 'exec-e2e-4',
        correlationId: 'corr-e2e-4',
        framework: TestFramework.JEST,
      });

      await testRunner.saveTestResult('exec-e2e-4', result, 'corr-e2e-4');

      expect(prisma.ticket.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: 'QA_FAILED' },
        }),
      );
    });
  });
});
