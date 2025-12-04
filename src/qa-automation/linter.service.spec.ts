/**
 * Unit tests for LinterService
 * Story 3.1: Linting Integration for Multiple Languages
 *
 * Tests language detection, linting execution, and database integration.
 * Mocks external dependencies (ESLint, CLI linters, database).
 */
import {
  SupportedLanguage,
  LintingSeverity,
  ILintingResult,
  FILE_EXTENSION_MAP,
} from './interfaces';

// Mock database/prisma.service first to prevent loading real Prisma client
jest.mock('../database/prisma.service', () => ({
  PrismaService: jest.fn().mockImplementation(() => ({})),
}));

// Mock sentry service
jest.mock('../common/sentry/sentry.service', () => ({
  SentryService: jest.fn().mockImplementation(() => ({
    captureException: jest.fn(),
  })),
}));

// Mock ESLint
const mockLintFiles = jest.fn().mockResolvedValue([]);
jest.mock('eslint', () => ({
  ESLint: jest.fn().mockImplementation(() => ({
    lintFiles: mockLintFiles,
  })),
}));

// Static property
Object.defineProperty(jest.requireMock('eslint').ESLint, 'version', {
  value: '9.0.0',
  writable: false,
});

// Mock child_process execFile
jest.mock('child_process', () => ({
  execFile: jest.fn((cmd, args, opts, callback) => {
    // Handle promisified version
    if (typeof opts === 'function') {
      callback = opts;
      opts = {};
    }
    if (callback) {
      callback(null, { stdout: '', stderr: '' });
    }
    return { stdout: '', stderr: '' };
  }),
}));

// Mock fs/promises
jest.mock('fs/promises', () => ({
  access: jest.fn().mockRejectedValue(new Error('ENOENT')),
}));

// Import after mocks are set up
import { LinterService } from './linter.service';

describe('LinterService', () => {
  // Mock dependencies
  const mockPrisma = {
    qAResult: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'qa-result-1' }),
      update: jest.fn().mockResolvedValue({ id: 'qa-result-1' }),
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
  };

  const mockSentry = {
    captureException: jest.fn().mockReturnValue('sentry-event-id'),
  };

  const mockCounter = { inc: jest.fn() };
  const mockHistogram = { startTimer: jest.fn().mockReturnValue(jest.fn()) };
  const mockGauge = { set: jest.fn() };

  let service: LinterService;

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset ESLint mock
    mockLintFiles.mockResolvedValue([]);

    // Create service instance with mocked dependencies
    service = new LinterService(
      mockPrisma as never,
      mockSentry as never,
      mockCounter as never,
      mockHistogram as never,
      mockGauge as never,
    );
  });

  afterEach(() => {
    // Cleanup any timers
    if (service) {
      service.onModuleDestroy();
    }
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('detectPrimaryLanguage', () => {
    it('should detect TypeScript from .ts files', () => {
      const files = ['src/main.ts', 'src/app.module.ts', 'src/service.ts'];
      const result = service.detectPrimaryLanguage(files);
      expect(result).toBe(SupportedLanguage.TYPESCRIPT);
    });

    it('should detect TypeScript from .tsx files', () => {
      const files = ['App.tsx', 'Component.tsx'];
      const result = service.detectPrimaryLanguage(files);
      expect(result).toBe(SupportedLanguage.TYPESCRIPT);
    });

    it('should detect JavaScript from .js files', () => {
      const files = ['index.js', 'utils.js', 'helper.mjs'];
      const result = service.detectPrimaryLanguage(files);
      expect(result).toBe(SupportedLanguage.JAVASCRIPT);
    });

    it('should detect Python from .py files', () => {
      const files = ['main.py', 'utils.py', 'models.py'];
      const result = service.detectPrimaryLanguage(files);
      expect(result).toBe(SupportedLanguage.PYTHON);
    });

    it('should detect Go from .go files', () => {
      const files = ['main.go', 'handler.go'];
      const result = service.detectPrimaryLanguage(files);
      expect(result).toBe(SupportedLanguage.GO);
    });

    it('should return UNKNOWN for unsupported extensions', () => {
      const files = ['file.xyz', 'document.pdf', 'image.png'];
      const result = service.detectPrimaryLanguage(files);
      expect(result).toBe(SupportedLanguage.UNKNOWN);
    });

    it('should detect primary language by majority', () => {
      const files = [
        'main.ts',
        'app.ts',
        'service.ts', // 3 TS
        'script.js', // 1 JS
      ];
      const result = service.detectPrimaryLanguage(files);
      expect(result).toBe(SupportedLanguage.TYPESCRIPT);
    });

    it('should handle empty file list', () => {
      const result = service.detectPrimaryLanguage([]);
      expect(result).toBe(SupportedLanguage.UNKNOWN);
    });

    it('should handle mixed extensions correctly', () => {
      const files = ['file.py', 'another.py', 'test.ts'];
      const result = service.detectPrimaryLanguage(files);
      expect(result).toBe(SupportedLanguage.PYTHON);
    });
  });

  describe('FILE_EXTENSION_MAP', () => {
    it('should map .ts to TypeScript', () => {
      expect(FILE_EXTENSION_MAP['.ts']).toBe(SupportedLanguage.TYPESCRIPT);
    });

    it('should map .tsx to TypeScript', () => {
      expect(FILE_EXTENSION_MAP['.tsx']).toBe(SupportedLanguage.TYPESCRIPT);
    });

    it('should map .js to JavaScript', () => {
      expect(FILE_EXTENSION_MAP['.js']).toBe(SupportedLanguage.JAVASCRIPT);
    });

    it('should map .py to Python', () => {
      expect(FILE_EXTENSION_MAP['.py']).toBe(SupportedLanguage.PYTHON);
    });

    it('should map .go to Go', () => {
      expect(FILE_EXTENSION_MAP['.go']).toBe(SupportedLanguage.GO);
    });
  });

  describe('lintFiles', () => {
    it('should lint TypeScript files with ESLint', async () => {
      const lintResults = [
        {
          filePath: '/workspace/src/main.ts',
          messages: [],
          errorCount: 0,
          warningCount: 0,
        },
      ];

      mockLintFiles.mockResolvedValue(lintResults);

      const result = await service.lintFiles({
        workspacePath: '/workspace',
        files: ['src/main.ts'],
      });

      expect(result.passed).toBe(true);
      expect(result.language).toBe(SupportedLanguage.TYPESCRIPT);
      expect(result.errorCount).toBe(0);
      expect(result.warningCount).toBe(0);
    });

    it('should return passed=true when no errors', async () => {
      const lintResults = [
        {
          filePath: '/workspace/src/main.ts',
          messages: [
            {
              line: 1,
              column: 1,
              severity: 1, // warning
              message: 'Unexpected var',
              ruleId: 'no-var',
            },
          ],
          errorCount: 0,
          warningCount: 1,
        },
      ];

      mockLintFiles.mockResolvedValue(lintResults);

      const result = await service.lintFiles({
        workspacePath: '/workspace',
        files: ['src/main.ts'],
      });

      expect(result.passed).toBe(true); // No errors = passed
      expect(result.warningCount).toBe(1);
    });

    it('should return passed=false when errors exist', async () => {
      const lintResults = [
        {
          filePath: '/workspace/src/main.ts',
          messages: [
            {
              line: 5,
              column: 10,
              severity: 2, // error
              message: "'foo' is not defined",
              ruleId: 'no-undef',
            },
          ],
          errorCount: 1,
          warningCount: 0,
        },
      ];

      mockLintFiles.mockResolvedValue(lintResults);

      const result = await service.lintFiles({
        workspacePath: '/workspace',
        files: ['src/main.ts'],
      });

      expect(result.passed).toBe(false);
      expect(result.errorCount).toBe(1);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].severity).toBe(LintingSeverity.ERROR);
      expect(result.issues[0].ruleId).toBe('no-undef');
    });

    it('should throw when linting already in progress for same workspace', async () => {
      // Start first lint (will hang because we don't resolve it immediately)
      let resolveLint: (value: unknown[]) => void;
      const slowLintPromise = new Promise<unknown[]>((resolve) => {
        resolveLint = resolve;
      });

      mockLintFiles.mockReturnValue(slowLintPromise);

      // Start first lint (don't await)
      const firstLint = service.lintFiles({
        workspacePath: '/workspace',
        files: ['src/main.ts'],
      });

      // Attempt second lint for same workspace
      await expect(
        service.lintFiles({
          workspacePath: '/workspace',
          files: ['src/other.ts'],
        }),
      ).rejects.toThrow('Linting already in progress');

      // Cleanup: resolve the pending promise
      resolveLint!([]);
      await firstLint;
    });

    it('should return empty result for unknown language', async () => {
      const result = await service.lintFiles({
        workspacePath: '/workspace',
        files: ['file.xyz'],
      });

      expect(result.passed).toBe(true);
      expect(result.language).toBe(SupportedLanguage.UNKNOWN);
      expect(result.issues).toHaveLength(0);
    });

    it('should handle empty file list', async () => {
      const result = await service.lintFiles({
        workspacePath: '/workspace',
        files: [],
      });

      expect(result.passed).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('should track metrics on success', async () => {
      mockLintFiles.mockResolvedValue([]);

      await service.lintFiles({
        workspacePath: '/workspace',
        files: ['src/main.ts'],
      });

      expect(mockHistogram.startTimer).toHaveBeenCalledWith({
        language: SupportedLanguage.TYPESCRIPT,
      });
      expect(mockCounter.inc).toHaveBeenCalledWith({
        language: SupportedLanguage.TYPESCRIPT,
        result: 'passed',
      });
    });

    it('should track metrics on failure', async () => {
      const lintResults = [
        {
          filePath: '/workspace/src/main.ts',
          messages: [{ line: 1, column: 1, severity: 2, message: 'Error', ruleId: 'rule' }],
        },
      ];

      mockLintFiles.mockResolvedValue(lintResults);

      await service.lintFiles({
        workspacePath: '/workspace',
        files: ['src/main.ts'],
      });

      expect(mockCounter.inc).toHaveBeenCalledWith({
        language: SupportedLanguage.TYPESCRIPT,
        result: 'failed',
      });
    });

    it('should apply warningsAsErrors option', async () => {
      const lintResults = [
        {
          filePath: '/workspace/src/main.ts',
          messages: [{ line: 1, column: 1, severity: 1, message: 'Warning', ruleId: 'rule' }],
        },
      ];

      mockLintFiles.mockResolvedValue(lintResults);

      const result = await service.lintFiles({
        workspacePath: '/workspace',
        files: ['src/main.ts'],
        warningsAsErrors: true,
      });

      expect(result.passed).toBe(false); // Warning treated as error
    });

    it('should include fix information when available', async () => {
      const lintResults = [
        {
          filePath: '/workspace/src/main.ts',
          messages: [
            {
              line: 1,
              column: 1,
              severity: 2,
              message: 'Use const',
              ruleId: 'prefer-const',
              fix: { range: [0, 3], text: 'const' },
            },
          ],
        },
      ];

      mockLintFiles.mockResolvedValue(lintResults);

      const result = await service.lintFiles({
        workspacePath: '/workspace',
        files: ['src/main.ts'],
      });

      expect(result.issues[0].fix).toBeDefined();
      expect(result.issues[0].fix?.replacementText).toBe('const');
    });

    describe('Python linting (Flake8)', () => {
      it('should throw when flake8 binary not found', async () => {
        // Mock 'which' to fail for flake8
        const { execFile } = jest.requireMock('child_process');
        execFile.mockImplementation(
          (
            cmd: string,
            args: string[],
            _opts: Record<string, unknown>,
            callback?: (err: Error | null, result: { stdout: string; stderr: string }) => void,
          ) => {
            if (cmd === 'which' && args[0] === 'flake8') {
              const error = new Error('not found');
              if (callback) callback(error, { stdout: '', stderr: '' });
              throw error;
            }
            if (callback) callback(null, { stdout: '', stderr: '' });
          },
        );

        await expect(
          service.lintFiles({
            workspacePath: '/workspace',
            files: ['main.py'],
          }),
        ).rejects.toThrow("Linter binary 'flake8' not found");
      });
    });

    describe('Go linting (golangci-lint)', () => {
      it('should throw when golangci-lint binary not found', async () => {
        // Mock 'which' to fail for golangci-lint
        const { execFile } = jest.requireMock('child_process');
        execFile.mockImplementation(
          (
            cmd: string,
            args: string[],
            _opts: Record<string, unknown>,
            callback?: (err: Error | null, result: { stdout: string; stderr: string }) => void,
          ) => {
            if (cmd === 'which' && args[0] === 'golangci-lint') {
              const error = new Error('not found');
              if (callback) callback(error, { stdout: '', stderr: '' });
              throw error;
            }
            if (callback) callback(null, { stdout: '', stderr: '' });
          },
        );

        await expect(
          service.lintFiles({
            workspacePath: '/workspace',
            files: ['main.go'],
          }),
        ).rejects.toThrow("Linter binary 'golangci-lint' not found");
      });
    });
  });

  describe('saveLintingResult', () => {
    it('should create QAResult record for new execution', async () => {
      const result: ILintingResult = {
        passed: true,
        errorCount: 0,
        warningCount: 0,
        infoCount: 0,
        issues: [],
        language: SupportedLanguage.TYPESCRIPT,
        filesLinted: ['src/main.ts'],
        durationMs: 100,
      };

      await service.saveLintingResult('exec-1', result);

      expect(mockPrisma.qAResult.findFirst).toHaveBeenCalledWith({
        where: { execution_id: 'exec-1' },
      });
      expect(mockPrisma.qAResult.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          execution_id: 'exec-1',
          linting_passed: true,
          linting_errors: [],
        }),
      });
    });

    it('should update existing QAResult record', async () => {
      mockPrisma.qAResult.findFirst.mockResolvedValueOnce({ id: 'existing-qa' });

      const result: ILintingResult = {
        passed: true,
        errorCount: 0,
        warningCount: 0,
        infoCount: 0,
        issues: [],
        language: SupportedLanguage.TYPESCRIPT,
        filesLinted: [],
        durationMs: 100,
      };

      await service.saveLintingResult('exec-1', result);

      expect(mockPrisma.qAResult.update).toHaveBeenCalledWith({
        where: { id: 'existing-qa' },
        data: expect.objectContaining({
          linting_passed: true,
        }),
      });
    });

    it('should update ticket status to QA_FAILED on failure', async () => {
      const failedResult: ILintingResult = {
        passed: false,
        errorCount: 3,
        warningCount: 0,
        infoCount: 0,
        issues: [
          {
            filePath: 'src/main.ts',
            line: 1,
            column: 1,
            severity: LintingSeverity.ERROR,
            message: 'Error',
            ruleId: 'rule',
          },
        ],
        language: SupportedLanguage.TYPESCRIPT,
        filesLinted: [],
        durationMs: 100,
      };

      await service.saveLintingResult('exec-1', failedResult);

      expect(mockPrisma.ticket.update).toHaveBeenCalledWith({
        where: { id: 'ticket-1' },
        data: { status: 'QA_FAILED' },
      });
    });

    it('should not update ticket status on success', async () => {
      const successResult: ILintingResult = {
        passed: true,
        errorCount: 0,
        warningCount: 0,
        infoCount: 0,
        issues: [],
        language: SupportedLanguage.TYPESCRIPT,
        filesLinted: [],
        durationMs: 100,
      };

      await service.saveLintingResult('exec-1', successResult);

      expect(mockPrisma.ticket.update).not.toHaveBeenCalled();
    });
  });

  describe('LintingSeverity enum', () => {
    it('should have correct values', () => {
      expect(LintingSeverity.ERROR).toBe('error');
      expect(LintingSeverity.WARNING).toBe('warning');
      expect(LintingSeverity.INFO).toBe('info');
    });
  });

  describe('SupportedLanguage enum', () => {
    it('should have correct values', () => {
      expect(SupportedLanguage.TYPESCRIPT).toBe('typescript');
      expect(SupportedLanguage.JAVASCRIPT).toBe('javascript');
      expect(SupportedLanguage.PYTHON).toBe('python');
      expect(SupportedLanguage.GO).toBe('go');
      expect(SupportedLanguage.UNKNOWN).toBe('unknown');
    });
  });
});
