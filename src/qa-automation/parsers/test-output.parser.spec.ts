import { TestOutputParser, JEST_SAMPLE_OUTPUT, PYTEST_SAMPLE_OUTPUT } from './test-output.parser';
import { TestFramework, TestStatus } from '../interfaces';

describe('TestOutputParser', () => {
  let parser: TestOutputParser;

  beforeEach(() => {
    parser = new TestOutputParser();
  });

  describe('parseJestJson', () => {
    it('should parse JEST_SAMPLE_OUTPUT correctly', () => {
      const result = parser.parse(JEST_SAMPLE_OUTPUT, TestFramework.JEST);

      expect(result.framework).toBe(TestFramework.JEST);
      expect(result.totalTests).toBe(5);
      expect(result.passedCount).toBe(4);
      expect(result.failedCount).toBe(1);
      expect(result.passed).toBe(false);
      expect(result.failedTests).toHaveLength(1);
    });

    it('should extract failed test details', () => {
      const result = parser.parse(JEST_SAMPLE_OUTPUT, TestFramework.JEST);

      const failedTest = result.failedTests[0];
      expect(failedTest.name).toBe('should fail');
      expect(failedTest.status).toBe(TestStatus.FAILED);
      expect(failedTest.errorMessage).toBe('Expected true to be false');
    });

    it('should handle Jest output with coverage', () => {
      const outputWithCoverage = JSON.stringify({
        numTotalTests: 10,
        numPassedTests: 10,
        numFailedTests: 0,
        testResults: [],
        coverageMap: {
          total: {
            lines: { pct: 85.5 },
            branches: { pct: 75.2 },
            functions: { pct: 90.1 },
            statements: { pct: 84.3 },
          },
        },
      });

      const result = parser.parse(outputWithCoverage, TestFramework.JEST);

      expect(result.coverage).toBeDefined();
      expect(result.coverage?.lines).toBe(85.5);
      expect(result.coverage?.branches).toBe(75.2);
    });

    it('should map Jest statuses correctly', () => {
      const output = JSON.stringify({
        numTotalTests: 4,
        numPassedTests: 1,
        numFailedTests: 1,
        numPendingTests: 2,
        testResults: [
          {
            name: 'test.spec.ts',
            startTime: 1000,
            endTime: 2000,
            assertionResults: [
              { title: 'passed', status: 'passed', duration: 50 },
              { title: 'failed', status: 'failed', duration: 50 },
              { title: 'skipped', status: 'skipped', duration: 0 },
              { title: 'pending', status: 'pending', duration: 0 },
            ],
          },
        ],
      });

      const result = parser.parse(output, TestFramework.JEST);

      expect(result.totalTests).toBe(4);
      expect(result.suites[0].passed).toBe(1);
      expect(result.suites[0].failed).toBe(1);
      expect(result.suites[0].skipped).toBe(2);
    });
  });

  describe('parsePyTestJson', () => {
    it('should parse PYTEST_SAMPLE_OUTPUT correctly', () => {
      const result = parser.parse(PYTEST_SAMPLE_OUTPUT, TestFramework.PYTEST);

      expect(result.framework).toBe(TestFramework.PYTEST);
      expect(result.totalTests).toBe(3);
      expect(result.passedCount).toBe(2);
      expect(result.failedCount).toBe(1);
      expect(result.passed).toBe(false);
    });

    it('should group tests by module', () => {
      const result = parser.parse(PYTEST_SAMPLE_OUTPUT, TestFramework.PYTEST);

      expect(result.suites).toHaveLength(1);
      expect(result.suites[0].name).toBe('tests/test_example.py');
      expect(result.suites[0].tests.length).toBeGreaterThan(0);
    });

    it('should extract error messages from PyTest output', () => {
      const result = parser.parse(PYTEST_SAMPLE_OUTPUT, TestFramework.PYTEST);

      const failedTest = result.failedTests[0];
      expect(failedTest.errorMessage).toBe('AssertionError');
    });
  });

  describe('parseGoTestJson', () => {
    it('should parse Go test JSON output', () => {
      const goOutput = [
        JSON.stringify({ Action: 'run', Package: 'pkg/util', Test: 'TestAdd' }),
        JSON.stringify({ Action: 'pass', Package: 'pkg/util', Test: 'TestAdd', Elapsed: 0.05 }),
        JSON.stringify({ Action: 'run', Package: 'pkg/util', Test: 'TestSubtract' }),
        JSON.stringify({
          Action: 'fail',
          Package: 'pkg/util',
          Test: 'TestSubtract',
          Elapsed: 0.02,
        }),
        JSON.stringify({
          Action: 'output',
          Package: 'pkg/util',
          Test: 'TestSubtract',
          Output: 'got 5, want 3',
        }),
      ].join('\n');

      const result = parser.parse(goOutput, TestFramework.GO_TEST);

      expect(result.framework).toBe(TestFramework.GO_TEST);
      expect(result.totalTests).toBe(2);
      expect(result.passedCount).toBe(1);
      expect(result.failedCount).toBe(1);
      expect(result.passed).toBe(false);
    });

    it('should handle line-delimited JSON format', () => {
      const goOutput = [
        JSON.stringify({ Action: 'run', Package: 'pkg', Test: 'Test1' }),
        JSON.stringify({ Action: 'pass', Package: 'pkg', Test: 'Test1', Elapsed: 0.01 }),
        'some non-JSON output',
        JSON.stringify({ Action: 'pass', Package: 'pkg', Elapsed: 0.05 }),
      ].join('\n');

      const result = parser.parse(goOutput, TestFramework.GO_TEST);

      expect(result.totalTests).toBe(1);
      expect(result.durationMs).toBe(50); // 0.05 * 1000
    });
  });

  describe('parseMochaJson', () => {
    it('should parse Mocha JSON output', () => {
      const mochaOutput = JSON.stringify({
        stats: {
          tests: 10,
          passes: 8,
          failures: 2,
          pending: 0,
          duration: 1500,
        },
        failures: [
          {
            title: 'should validate input',
            fullTitle: 'Validator > should validate input',
            duration: 50,
            err: {
              message: 'Expected 5 to equal 10',
              stack: 'Error: Expected 5 to equal 10\n  at test.js:10:5',
            },
            file: 'test/validator.test.js',
          },
        ],
      });

      const result = parser.parse(mochaOutput, TestFramework.MOCHA);

      expect(result.framework).toBe(TestFramework.MOCHA);
      expect(result.totalTests).toBe(10);
      expect(result.passedCount).toBe(8);
      expect(result.failedCount).toBe(2);
      expect(result.passed).toBe(false);
      expect(result.failedTests).toHaveLength(1);
    });

    it('should extract failed test metadata', () => {
      const mochaOutput = JSON.stringify({
        stats: { tests: 1, passes: 0, failures: 1 },
        failures: [
          {
            title: 'test name',
            fullTitle: 'Suite > test name',
            duration: 100,
            err: { message: 'error' },
            file: 'test.js',
          },
        ],
      });

      const result = parser.parse(mochaOutput, TestFramework.MOCHA);

      const failed = result.failedTests[0];
      expect(failed.name).toBe('test name');
      expect(failed.suiteName).toBe('Suite >');
      expect(failed.filePath).toBe('test.js');
    });
  });

  describe('error handling', () => {
    it('should return empty result on parse error', () => {
      const invalidJson = 'not valid json';

      const result = parser.parse(invalidJson, TestFramework.JEST);

      expect(result.passed).toBe(false);
      expect(result.totalTests).toBe(0);
      expect(result.rawOutput).toContain('Parse error');
    });

    it('shouldhandle unknown framework', () => {
      const result = parser.parse('{}', TestFramework.UNKNOWN);

      expect(result.framework).toBe(TestFramework.UNKNOWN);
      expect(result.passed).toBe(false);
      expect(result.rawOutput).toContain('Unknown framework');
    });

    it('should gracefully handle malformed Jest JSON', () => {
      const malformed = JSON.stringify({
        numTotalTests: 5,
        // Missing required fields
      });

      const result = parser.parse(malformed, TestFramework.JEST);

      // Should not throw, return valid (though possibly empty) structure
      expect(result.framework).toBe(TestFramework.JEST);
    });
  });
});
