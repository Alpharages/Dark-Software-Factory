/**
 * Unit tests for TestRunnerService
 * Story 3.2: Automated Test Execution Framework
 *
 * Tests framework detection, test execution, and database integration.
 * Uses direct constructor injection pattern like LinterService tests.
 */
import { TestRunnerService } from './test-runner.service';
import { IDockerRunResult } from './docker-executor.service';
import { TestFramework, TestStatus } from './interfaces';

import * as fs from 'fs/promises';

// Mock fs/promises
jest.mock('fs/promises');

describe('TestRunnerService', () => {
  // Mock dependencies
  const mockPrisma = {
    qAResult: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'qa-1' }),
      update: jest.fn().mockResolvedValue({ id: 'qa-1' }),
    },
    auditLog: {
      create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
    },
    execution: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    ticket: {
      update: jest.fn().mockResolvedValue({ id: 'ticket-1' }),
    },
  };

  const mockConfig = {
    get: jest.fn().mockReturnValue(300000),
  };

  const mockSentry = {
    captureException: jest.fn(),
  };

  const mockDockerExecutor = {
    isDockerAvailable: jest.fn().mockResolvedValue(true),
    ensureImage: jest.fn().mockResolvedValue(undefined),
    executeInContainer: jest.fn(),
  };

  const mockCounter = { inc: jest.fn() };
  const mockHistogram = { startTimer: jest.fn().mockReturnValue(jest.fn()) };

  let service: TestRunnerService;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create service instance with mocked dependencies (direct injection)
    service = new TestRunnerService(
      mockPrisma as never,
      mockConfig as never,
      mockSentry as never,
      mockDockerExecutor as never,
      mockCounter as never,
      mockHistogram as never,
      mockCounter as never,
      mockCounter as never,
    );
  });

  describe('detectFramework', () => {
    it('should detect Jest from package.json', async () => {
      (fs.readFile as jest.Mock).mockResolvedValueOnce(
        JSON.stringify({ devDependencies: { jest: '^29.0.0' } }),
      );

      const framework = await service.detectFramework('/test/workspace');

      expect(framework).toBe(TestFramework.JEST);
    });

    it('should detect Vitest from package.json', async () => {
      (fs.readFile as jest.Mock).mockResolvedValueOnce(
        JSON.stringify({ devDependencies: { vitest: '^0.34.0' } }),
      );

      const framework = await service.detectFramework('/test/workspace');

      expect(framework).toBe(TestFramework.VITEST);
    });

    it('should detect PyTest from pytest.ini', async () => {
      (fs.readFile as jest.Mock).mockRejectedValueOnce(new Error('no package.json'));
      (fs.access as jest.Mock).mockResolvedValueOnce(undefined);

      const framework = await service.detectFramework('/test/workspace');

      expect(framework).toBe(TestFramework.PYTEST);
    });

    it('should detect PyTest from pyproject.toml', async () => {
      (fs.readFile as jest.Mock)
        .mockRejectedValueOnce(new Error('no package.json'))
        .mockResolvedValueOnce('[tool.pytest.ini_options]');
      (fs.access as jest.Mock).mockRejectedValueOnce(new Error('no pytest.ini'));

      const framework = await service.detectFramework('/test/workspace');

      expect(framework).toBe(TestFramework.PYTEST);
    });

    it('should detect Go from go.mod', async () => {
      // Sequence: package.json read fails, pytest.ini access fails, pyproject.toml read fails, go.mod access succeeds
      (fs.readFile as jest.Mock)
        .mockRejectedValueOnce(new Error('no package.json'))
        .mockRejectedValueOnce(new Error('no pyproject.toml'));
      (fs.access as jest.Mock)
        .mockRejectedValueOnce(new Error('no pytest.ini'))
        .mockResolvedValueOnce(undefined); // go.mod exists

      const framework = await service.detectFramework('/test/workspace');

      expect(framework).toBe(TestFramework.GO_TEST);
    });

    it('should return UNKNOWN when no framework detected', async () => {
      // All checks fail: package.json, pyproject.toml readFile fail, pytest.ini and go.mod access fail
      (fs.readFile as jest.Mock)
        .mockRejectedValueOnce(new Error('no package.json'))
        .mockRejectedValueOnce(new Error('no pyproject.toml'));
      (fs.access as jest.Mock)
        .mockRejectedValueOnce(new Error('no pytest.ini'))
        .mockRejectedValueOnce(new Error('no go.mod'));

      const framework = await service.detectFramework('/test/workspace');

      expect(framework).toBe(TestFramework.UNKNOWN);
    });
  });

  describe('runTests', () => {
    const mockDockerResult: IDockerRunResult = {
      exitCode: 0,
      stdout: '',
      stderr: '',
      timedOut: false,
      durationMs: 1500,
    };

    beforeEach(() => {
      mockDockerExecutor.isDockerAvailable.mockResolvedValue(true);
      mockDockerExecutor.ensureImage.mockResolvedValue(undefined);
      mockDockerExecutor.executeInContainer.mockResolvedValue(mockDockerResult);
      (fs.readFile as jest.Mock).mockResolvedValue(
        JSON.stringify({
          numTotalTests: 10,
          numPassedTests: 10,
          numFailedTests: 0,
          numPendingTests: 0,
          testResults: [],
        }),
      );
    });

    it('should run Jest tests and parse results', async () => {
      const result = await service.runTests({
        workspacePath: '/test/workspace',
        executionId: 'exec-123',
        correlationId: 'corr-456',
        framework: TestFramework.JEST,
      });

      expect(result.framework).toBe(TestFramework.JEST);
      expect(result.passed).toBe(true);
      expect(result.totalTests).toBe(10);
    });

    it('should propagate correlationId through execution', async () => {
      const correlationId = 'test-correlation-id';

      await service.runTests({
        workspacePath: '/test/workspace',
        executionId: 'exec-123',
        correlationId,
        framework: TestFramework.JEST,
      });

      expect(mockDockerExecutor.executeInContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          correlationId,
        }),
      );
    });

    it('should return passed=true when all tests pass', async () => {
      const result = await service.runTests({
        workspacePath: '/test',
        executionId: 'exec-1',
        correlationId: 'corr-1',
        framework: TestFramework.JEST,
      });

      expect(result.passed).toBe(true);
    });

    it('should return passed=false when tests fail', async () => {
      (fs.readFile as jest.Mock).mockResolvedValue(
        JSON.stringify({
          numTotalTests: 10,
          numPassedTests: 8,
          numFailedTests: 2,
          testResults: [],
        }),
      );

      const result = await service.runTests({
        workspacePath: '/test',
        executionId: 'exec-1',
        correlationId: 'corr-1',
        framework: TestFramework.JEST,
      });

      expect(result.passed).toBe(false);
      expect(result.failedCount).toBe(2);
    });

    it('should throw when tests already in progress', async () => {
      const options = {
        workspacePath: '/test',
        executionId: 'exec-1',
        correlationId: 'corr-1',
      };

      // Start first test (don't await)
      const promise1 = service.runTests(options);

      // Try to start second test
      await expect(service.runTests(options)).rejects.toThrow('Tests already in progress');

      // Clean up
      await promise1;
    });

    it('should handle timeout correctly', async () => {
      mockDockerExecutor.executeInContainer.mockResolvedValue({
        ...mockDockerResult,
        timedOut: true,
        exitCode: 124,
      });

      const result = await service.runTests({
        workspacePath: '/test',
        executionId: 'exec-1',
        correlationId: 'corr-1',
        framework: TestFramework.JEST,
        timeoutMs: 5000,
      });

      expect(result.passed).toBe(false);
      expect(result.failedCount).toBe(1);
      expect(result.failedTests[0].errorMessage).toContain('timed out');
    });

    it('should use ErrorCategory.QA_AUTOMATION for Sentry', async () => {
      const error = new Error('Test execution failed');
      mockDockerExecutor.executeInContainer.mockRejectedValue(error);

      await expect(
        service.runTests({
          workspacePath: '/test',
          executionId: 'exec-1',
          correlationId: 'corr-1',
          framework: TestFramework.JEST,
        }),
      ).rejects.toThrow();

      expect(mockSentry.captureException).toHaveBeenCalledWith(
        error,
        expect.objectContaining({
          category: expect.any(String),
        }),
      );
    });

    it('should track metrics on completion', async () => {
      await service.runTests({
        workspacePath: '/test',
        executionId: 'exec-1',
        correlationId: 'corr-1',
        framework: TestFramework.JEST,
      });

      expect(mockCounter.inc).toHaveBeenCalledWith({
        framework: TestFramework.JEST,
        result: 'passed',
      });
      expect(mockCounter.inc).toHaveBeenCalledWith({ framework: TestFramework.JEST }, 10);
    });

    it('should return skipped result when no framework detected', async () => {
      const result = await service.runTests({
        workspacePath: '/test',
        executionId: 'exec-1',
        correlationId: 'corr-1',
        framework: TestFramework.UNKNOWN,
      });

      expect(result.passed).toBe(true);
      expect(result.totalTests).toBe(0);
      expect(result.rawOutput).toContain('No test framework detected');
    });
  });

  describe('saveTestResult', () => {
    const mockResult = {
      framework: TestFramework.JEST,
      passed: true,
      totalTests: 10,
      passedCount: 10,
      failedCount: 0,
      skippedCount: 0,
      durationMs: 1500,
      suites: [],
      failedTests: [],
    };

    it('should create QAResult record when none exists', async () => {
      await service.saveTestResult('exec-1', mockResult, 'corr-1');

      expect(mockPrisma.qAResult.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            execution_id: 'exec-1',
            tests_passed: true,
          }),
        }),
      );
    });

    it('should update existing QAResult record', async () => {
      mockPrisma.qAResult.findFirst.mockResolvedValueOnce({
        id: 'qa-1',
        execution_id: 'exec-1',
        linting_passed: true,
        tests_passed: false,
        test_results: null,
        test_coverage: null,
        code_review_passed: false,
        overall_passed: false,
        linting_errors: null,
        code_review_issues: null,
        created_at: new Date(),
      });

      await service.saveTestResult('exec-1', mockResult, 'corr-1');

      expect(mockPrisma.qAResult.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'qa-1' },
          data: expect.objectContaining({
            tests_passed: true,
          }),
        }),
      );
    });

    it('should create audit log entry', async () => {
      await service.saveTestResult('exec-1', mockResult, 'corr-1');

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            entity_type: 'execution',
            entity_id: 'exec-1',
            action: 'tests_executed',
            actor_type: 'system',
          }),
        }),
      );
    });

    it('should update ticket status to QA_FAILED on test failure', async () => {
      const failedResult = {
        ...mockResult,
        passed: false,
        failedCount: 2,
        failedTests: [
          { name: 'test1', suiteName: 'suite', status: TestStatus.FAILED, durationMs: 100 },
          { name: 'test2', suiteName: 'suite', status: TestStatus.FAILED, durationMs: 100 },
        ],
      };

      mockPrisma.execution.findUnique.mockResolvedValueOnce({
        id: 'exec-1',
        ticket_id: 'ticket-1',
      });

      await service.saveTestResult('exec-1', failedResult, 'corr-1');

      expect(mockPrisma.ticket.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'ticket-1' },
          data: { status: 'QA_FAILED' },
        }),
      );
    });
  });
});
