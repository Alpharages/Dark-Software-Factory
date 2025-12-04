import { Logger } from '@nestjs/common';
import { ITestResult, ITestCase, ITestSuite, TestFramework, TestStatus } from '../interfaces';

/**
 * Sample Jest JSON output for testing (use in unit tests)
 */
export const JEST_SAMPLE_OUTPUT = JSON.stringify({
  numTotalTests: 5,
  numPassedTests: 4,
  numFailedTests: 1,
  numPendingTests: 0,
  testResults: [
    {
      name: '/app/src/example.spec.ts',
      startTime: 1700000000000,
      endTime: 1700000001500,
      assertionResults: [
        { title: 'should pass', status: 'passed', duration: 50 },
        {
          title: 'should fail',
          status: 'failed',
          duration: 100,
          failureMessages: ['Expected true to be false'],
        },
      ],
    },
  ],
});

/**
 * Sample PyTest JSON output for testing
 */
export const PYTEST_SAMPLE_OUTPUT = JSON.stringify({
  summary: { total: 3, passed: 2, failed: 1 },
  duration: 2.5,
  tests: [
    { nodeid: 'tests/test_example.py::test_one', outcome: 'passed', call: { duration: 0.1 } },
    {
      nodeid: 'tests/test_example.py::test_two',
      outcome: 'failed',
      call: { duration: 0.2, longrepr: 'AssertionError' },
    },
  ],
});

export interface ITestOutputParser {
  parse(output: string, framework: TestFramework): ITestResult;
}

export class TestOutputParser implements ITestOutputParser {
  private readonly logger = new Logger(TestOutputParser.name);

  /**
   * Parse test output based on framework (JSON only)
   */
  parse(output: string, framework: TestFramework): ITestResult {
    try {
      switch (framework) {
        case TestFramework.JEST:
        case TestFramework.VITEST:
          return this.parseJestJson(output);
        case TestFramework.PYTEST:
          return this.parsePyTestJson(output);
        case TestFramework.GO_TEST:
          return this.parseGoTestJson(output);
        case TestFramework.MOCHA:
          return this.parseMochaJson(output);
        default:
          return this.createEmptyResult(framework, 'Unknown framework');
      }
    } catch (error) {
      this.logger.error(`Failed to parse ${framework} output: ${(error as Error).message}`);
      return this.createEmptyResult(framework, (error as Error).message);
    }
  }

  /**
   * Parse Jest JSON reporter output
   * Format: { numTotalTests, numPassedTests, numFailedTests, testResults: [...] }
   */
  private parseJestJson(output: string): ITestResult {
    const json = JSON.parse(output);

    const failedTests: ITestCase[] = [];
    const suites: ITestSuite[] = [];

    for (const testFile of json.testResults || []) {
      const suite: ITestSuite = {
        name: testFile.name,
        tests: [],
        passed: 0,
        failed: 0,
        skipped: 0,
        durationMs: testFile.endTime - testFile.startTime,
      };

      for (const assertion of testFile.assertionResults || []) {
        const testCase: ITestCase = {
          name: assertion.title,
          suiteName: assertion.ancestorTitles?.join(' > ') || testFile.name,
          status: this.mapJestStatus(assertion.status),
          durationMs: assertion.duration || 0,
          errorMessage: assertion.failureMessages?.join('\n'),
          stackTrace: assertion.failureDetails?.[0]?.stack,
          filePath: testFile.name,
        };

        suite.tests.push(testCase);

        if (testCase.status === TestStatus.PASSED) suite.passed++;
        else if (testCase.status === TestStatus.FAILED) {
          suite.failed++;
          failedTests.push(testCase);
        } else suite.skipped++;
      }

      suites.push(suite);
    }

    // Parse coverage if available
    let coverage;
    if (json.coverageMap || json.coverage) {
      const cov = json.coverageMap?.total || json.coverage?.total;
      if (cov) {
        coverage = {
          lines: cov.lines?.pct || 0,
          branches: cov.branches?.pct || 0,
          functions: cov.functions?.pct || 0,
          statements: cov.statements?.pct || 0,
        };
      }
    }

    return {
      framework: TestFramework.JEST,
      passed: json.numFailedTests === 0,
      totalTests: json.numTotalTests,
      passedCount: json.numPassedTests,
      failedCount: json.numFailedTests,
      skippedCount: json.numPendingTests || 0,
      durationMs:
        json.testResults?.reduce(
          (sum: number, t: { endTime: number; startTime: number }) =>
            sum + (t.endTime - t.startTime),
          0,
        ) || 0,
      suites,
      failedTests,
      coverage,
    };
  }

  /**
   * Parse PyTest JSON report output
   * Format: { summary: {...}, tests: [...], duration: float }
   */
  private parsePyTestJson(output: string): ITestResult {
    const json = JSON.parse(output);
    const summary = json.summary || {};

    const failedTests: ITestCase[] = [];
    const suites: ITestSuite[] = [];

    const testsByModule = new Map<string, ITestCase[]>();

    for (const test of json.tests || []) {
      const moduleName = test.nodeid?.split('::')[0] || 'unknown';
      const testCase: ITestCase = {
        name: test.nodeid?.split('::').pop() || test.nodeid,
        suiteName: moduleName,
        status: this.mapPyTestStatus(test.outcome),
        durationMs: (test.call?.duration || 0) * 1000,
        errorMessage: test.call?.longrepr,
        filePath: moduleName,
      };

      if (!testsByModule.has(moduleName)) {
        testsByModule.set(moduleName, []);
      }
      testsByModule.get(moduleName)!.push(testCase);

      if (testCase.status === TestStatus.FAILED) {
        failedTests.push(testCase);
      }
    }

    for (const [name, tests] of testsByModule) {
      suites.push({
        name,
        tests,
        passed: tests.filter((t) => t.status === TestStatus.PASSED).length,
        failed: tests.filter((t) => t.status === TestStatus.FAILED).length,
        skipped: tests.filter((t) => t.status === TestStatus.SKIPPED).length,
        durationMs: tests.reduce((sum, t) => sum + t.durationMs, 0),
      });
    }

    return {
      framework: TestFramework.PYTEST,
      passed: (summary.failed || 0) === 0,
      totalTests: summary.total || 0,
      passedCount: summary.passed || 0,
      failedCount: summary.failed || 0,
      skippedCount: summary.skipped || 0,
      durationMs: (json.duration || 0) * 1000,
      suites,
      failedTests,
    };
  }

  /**
   * Parse Go test JSON output (line-delimited JSON)
   * Each line: { Action, Package, Test?, Elapsed?, Output? }
   */
  private parseGoTestJson(output: string): ITestResult {
    const lines = output.split('\n').filter((l) => l.trim());
    const tests = new Map<string, ITestCase>();
    let totalDuration = 0;

    for (const line of lines) {
      try {
        const event = JSON.parse(line);

        if (event.Test && event.Action) {
          const key = `${event.Package}::${event.Test}`;

          if (event.Action === 'run') {
            tests.set(key, {
              name: event.Test,
              suiteName: event.Package,
              status: TestStatus.PENDING,
              durationMs: 0,
            });
          } else if (
            event.Action === 'pass' ||
            event.Action === 'fail' ||
            event.Action === 'skip'
          ) {
            const test = tests.get(key);
            if (test) {
              test.status =
                event.Action === 'pass'
                  ? TestStatus.PASSED
                  : event.Action === 'fail'
                    ? TestStatus.FAILED
                    : TestStatus.SKIPPED;
              test.durationMs = (event.Elapsed || 0) * 1000;
            }
          } else if (event.Action === 'output' && event.Output) {
            const test = tests.get(key);
            if (test && test.status === TestStatus.FAILED) {
              test.errorMessage = (test.errorMessage || '') + event.Output;
            }
          }
        }

        if (event.Action === 'pass' && !event.Test && event.Elapsed) {
          totalDuration += event.Elapsed * 1000;
        }
      } catch {
        // Skip non-JSON lines (common in go test output)
      }
    }

    const allTests = Array.from(tests.values());
    const failedTests = allTests.filter((t) => t.status === TestStatus.FAILED);

    return {
      framework: TestFramework.GO_TEST,
      passed: failedTests.length === 0,
      totalTests: allTests.length,
      passedCount: allTests.filter((t) => t.status === TestStatus.PASSED).length,
      failedCount: failedTests.length,
      skippedCount: allTests.filter((t) => t.status === TestStatus.SKIPPED).length,
      durationMs: totalDuration,
      suites: [],
      failedTests,
    };
  }

  /**
   * Parse Mocha JSON reporter output
   * Format: { stats: {...}, failures: [...] }
   */
  private parseMochaJson(output: string): ITestResult {
    const json = JSON.parse(output);
    const stats = json.stats || {};

    const failedTests: ITestCase[] = (json.failures || []).map(
      (f: {
        title: string;
        fullTitle: string;
        duration: number;
        err?: { message?: string; stack?: string };
        file?: string;
      }) => ({
        name: f.title,
        suiteName: f.fullTitle?.replace(f.title, '').trim() || 'unknown',
        status: TestStatus.FAILED,
        durationMs: f.duration || 0,
        errorMessage: f.err?.message,
        stackTrace: f.err?.stack,
        filePath: f.file,
      }),
    );

    return {
      framework: TestFramework.MOCHA,
      passed: stats.failures === 0,
      totalTests: stats.tests || 0,
      passedCount: stats.passes || 0,
      failedCount: stats.failures || 0,
      skippedCount: stats.pending || 0,
      durationMs: stats.duration || 0,
      suites: [],
      failedTests,
    };
  }

  private mapJestStatus(status: string): TestStatus {
    switch (status) {
      case 'passed':
        return TestStatus.PASSED;
      case 'failed':
        return TestStatus.FAILED;
      case 'pending':
      case 'skipped':
      case 'todo':
        return TestStatus.SKIPPED;
      default:
        return TestStatus.PENDING;
    }
  }

  private mapPyTestStatus(outcome: string): TestStatus {
    switch (outcome) {
      case 'passed':
        return TestStatus.PASSED;
      case 'failed':
        return TestStatus.FAILED;
      case 'skipped':
        return TestStatus.SKIPPED;
      default:
        return TestStatus.PENDING;
    }
  }

  private createEmptyResult(framework: TestFramework, error: string): ITestResult {
    return {
      framework,
      passed: false,
      totalTests: 0,
      passedCount: 0,
      failedCount: 0,
      skippedCount: 0,
      durationMs: 0,
      suites: [],
      failedTests: [],
      rawOutput: `Parse error: ${error}`,
    };
  }
}
