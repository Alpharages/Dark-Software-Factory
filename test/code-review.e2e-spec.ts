import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from '../src/config/configuration';
import { PrismaService } from '../src/database/prisma.service';
import { SentryService } from '../src/common/sentry/sentry.service';
import { CodeReviewService } from '../src/qa-automation/code-review.service';
import { QaAutomationModule } from '../src/qa-automation/qa-automation.module';
import { ISecurityScanOptions } from '../src/qa-automation/interfaces';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('CodeReviewService (e2e)', () => {
  let app: INestApplication;
  let codeReviewService: CodeReviewService;
  let prisma: PrismaService;
  let testWorkspace: string;

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
      .overrideProvider(PrismaService)
      .useValue({
        qAResult: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({ id: 'qa-result-1' }),
          update: jest.fn().mockResolvedValue({ id: 'qa-result-1' }),
        },
        auditLog: {
          create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
        },
        execution: {
          findUnique: jest.fn().mockResolvedValue({ id: 'exec-1', ticket_id: 'ticket-1' }),
        },
        ticket: {
          update: jest.fn().mockResolvedValue({ id: 'ticket-1', status: 'QA_FAILED' }),
        },
      })
      .overrideProvider(SentryService)
      .useValue({
        captureException: jest.fn(),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    codeReviewService = moduleFixture.get<CodeReviewService>(CodeReviewService);
    prisma = moduleFixture.get<PrismaService>(PrismaService);

    // Create temporary test workspace
    testWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'code-review-test-'));
  });

  afterAll(async () => {
    // Cleanup test workspace
    await fs.rm(testWorkspace, { recursive: true, force: true });
    await app.close();
  });

  describe('Full Security Scan Workflow', () => {
    it('should execute all 4 scanners in parallel and aggregate results', async () => {
      // Create a simple package.json for npm detection
      await fs.writeFile(
        path.join(testWorkspace, 'package.json'),
        JSON.stringify({ name: 'test', version: '1.0.0', dependencies: {} }),
      );

      const options: ISecurityScanOptions = {
        workspacePath: testWorkspace,
        executionId: 'exec-test-1',
        correlationId: 'corr-test-1',
        projectId: 'proj-1',
        language: 'typescript',
      };

      const result = await codeReviewService.scan(options);

      // Verify result structure
      expect(result).toHaveProperty('passed');
      expect(result).toHaveProperty('executionId', 'exec-test-1');
      expect(result).toHaveProperty('correlationId', 'corr-test-1');
      expect(result).toHaveProperty('scanDurationMs');
      expect(result).toHaveProperty('summary');
      expect(result).toHaveProperty('vulnerabilities');
      expect(result).toHaveProperty('secrets');
      expect(result).toHaveProperty('complexityIssues');
      expect(result).toHaveProperty('patternFindings');

      // Verify all scanners ran
      expect(result.scannerResults.dependency.ran).toBe(true);
      expect(result.scannerResults.secrets.ran).toBe(true);
      expect(result.scannerResults.complexity.ran).toBe(true);
      expect(result.scannerResults.patterns.ran).toBe(true);

      // Verify per-scanner timing tracked
      expect(result.scannerResults.dependency.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.scannerResults.secrets.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should detect secrets and mask them properly (NFR-S4)', async () => {
      // Create a file with a hardcoded AWS key
      const awsKeyFile = path.join(testWorkspace, 'config.ts');
      const awsAccessKey = 'AKIAIOSFODNN7EXAMPLE';
      await fs.writeFile(awsKeyFile, `export const AWS_KEY = "${awsAccessKey}";\n`);

      const options: ISecurityScanOptions = {
        workspacePath: testWorkspace,
        executionId: 'exec-test-2',
        correlationId: 'corr-test-2',
        projectId: 'proj-1',
      };

      const result = await codeReviewService.scan(options);

      // Should find the secret
      expect(result.secrets.length).toBeGreaterThan(0);

      const awsSecret = result.secrets.find((s) => s.secretType === 'aws_access_key');
      expect(awsSecret).toBeDefined();

      // Verify masking: first 4 + *** + last 4 (may include quotes from source)
      expect(awsSecret?.maskedValue).toMatch(/^["']?AKI.*\*\*\*.*PLE["']?$/);
      expect(awsSecret?.maskedValue).not.toContain(awsAccessKey);

      // Verify scan failed due to critical secret
      expect(result.passed).toBe(false);
      expect(result.summary.criticalCount).toBeGreaterThan(0);
    });

    it('should persist results to database via saveResult()', async () => {
      const options: ISecurityScanOptions = {
        workspacePath: testWorkspace,
        executionId: 'exec-test-3',
        correlationId: 'corr-test-3',
        projectId: 'proj-1',
      };

      const scanResult = await codeReviewService.scan(options);
      await codeReviewService.saveResult('exec-test-3', scanResult);

      // Verify QAResult created
      expect(prisma.qAResult.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            execution_id: 'exec-test-3',
            code_review_passed: expect.any(Boolean),
            code_review_issues: expect.any(Object),
          }),
        }),
      );

      // Verify AuditLog created
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            entity_type: 'execution',
            entity_id: 'exec-test-3',
            action: 'code_review_scanned',
            actor_type: 'system',
          }),
        }),
      );
    });

    it('should update ticket status to QA_FAILED on critical findings', async () => {
      // Create file with SQL injection pattern
      const vulnFile = path.join(testWorkspace, 'api.ts');
      await fs.writeFile(
        vulnFile,
        `const query = "SELECT * FROM users WHERE id = " + req.params.id;\n`,
      );

      const options: ISecurityScanOptions = {
        workspacePath: testWorkspace,
        executionId: 'exec-test-4',
        correlationId: 'corr-test-4',
        projectId: 'proj-1',
      };

      const scanResult = await codeReviewService.scan(options);
      expect(scanResult.passed).toBe(false);

      await codeReviewService.saveResult('exec-test-4', scanResult);

      // Verify ticket status updated
      expect(prisma.ticket.update).toHaveBeenCalledWith({
        where: { id: 'ticket-1' },
        data: { status: 'QA_FAILED' },
      });
    });
  });

  describe('Individual Scanner Validation', () => {
    it('should detect OWASP security patterns', async () => {
      const vulnFile = path.join(testWorkspace, 'xss.ts');
      await fs.writeFile(vulnFile, `document.getElementById('output').innerHTML = userInput;\n`);

      const options: ISecurityScanOptions = {
        workspacePath: testWorkspace,
        executionId: 'exec-test-5',
        correlationId: 'corr-test-5',
        projectId: 'proj-1',
      };

      const result = await codeReviewService.scan(options);

      const xssPattern = result.patternFindings.find((p) => p.patternType === 'xss_innerhtml');
      expect(xssPattern).toBeDefined();
      expect(xssPattern?.owaspCategory).toBe('A03:2021-Injection');
      expect(xssPattern?.severity).toBe('high');
    });

    it('should skip scanners when skip flags provided', async () => {
      const options: ISecurityScanOptions = {
        workspacePath: testWorkspace,
        executionId: 'exec-test-6',
        correlationId: 'corr-test-6',
        projectId: 'proj-1',
        skipDependencyScan: true,
        skipSecretsScan: true,
      };

      const result = await codeReviewService.scan(options);

      expect(result.scannerResults.dependency.ran).toBe(true); // Still marked as ran
      expect(result.vulnerabilities).toEqual([]);
      expect(result.secrets).toEqual([]);
    });
  });
});
