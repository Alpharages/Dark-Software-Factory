/**
 * QA Results Service Unit Tests
 * Story 3.6: QA Results Storage & Retrieval
 * Target: >80% coverage
 */

import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getToken } from '@willsoto/nestjs-prometheus';
import { QaResultsService } from './qa-results.service';
import { PrismaService } from '../database/prisma.service';
import { LoggerService } from '../common/logger/logger.service';
import { SentryService } from '../common/sentry/sentry.service';
import { QA_METRICS } from '../common/metrics/metrics.constants';
import { QaResultFilterStatus } from './interfaces';

describe('QaResultsService', () => {
  let service: QaResultsService;

  const mockQaResult = {
    id: 'qa-result-1',
    execution_id: 'exec-1',
    linting_passed: true,
    linting_errors: null,
    tests_passed: true,
    test_results: { total: 10, passed: 10 },
    test_coverage: 85.5,
    code_review_passed: true,
    code_review_issues: null,
    overall_passed: true,
    created_at: new Date('2025-12-01T10:00:00Z'),
    updated_at: new Date('2025-12-01T10:05:00Z'),
  };

  const mockExecution = {
    id: 'exec-1',
    ticket_id: 'ticket-1',
    ai_provider: 'CLAUDE_CODE',
    status: 'COMPLETED',
    ticket: {
      id: 'ticket-1',
      title: 'Test Ticket',
      project_id: 'project-1',
      clickup_task_id: 'clickup-1',
    },
  };

  const mockQaResultWithExecution = {
    ...mockQaResult,
    execution: mockExecution,
  };

  const mockPrismaService = {
    qAResult: {
      create: jest.fn(),
      upsert: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
    },
    execution: {
      findMany: jest.fn(),
    },
    ticket: {
      findMany: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
  };

  const mockCounter = { inc: jest.fn() };
  const mockHistogram = { startTimer: jest.fn(() => jest.fn()) };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QaResultsService,
        { provide: PrismaService, useValue: mockPrismaService },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue: number) => defaultValue),
          },
        },
        {
          provide: LoggerService,
          useValue: {
            debug: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
          },
        },
        {
          provide: SentryService,
          useValue: {
            captureException: jest.fn(),
          },
        },
        { provide: getToken(QA_METRICS.QA_RESULTS_QUERIES_TOTAL), useValue: mockCounter },
        { provide: getToken(QA_METRICS.QA_RESULTS_QUERY_DURATION), useValue: mockHistogram },
      ],
    }).compile();

    service = module.get<QaResultsService>(QaResultsService);
  });

  describe('savePartialResult', () => {
    it('should create new result if none exists for execution', async () => {
      mockPrismaService.qAResult.findFirst.mockResolvedValue(null);
      mockPrismaService.qAResult.create.mockResolvedValue(mockQaResult);

      const result = await service.savePartialResult('exec-1', {
        linting_passed: true,
        linting_errors: { errors: [] },
      });

      expect(mockPrismaService.qAResult.findFirst).toHaveBeenCalledWith({
        where: { execution_id: 'exec-1' },
      });
      expect(mockPrismaService.qAResult.create).toHaveBeenCalled();
      expect(result.id).toBe('qa-result-1');
    });

    it('should update existing result', async () => {
      mockPrismaService.qAResult.findFirst.mockResolvedValue(mockQaResult);
      mockPrismaService.qAResult.update.mockResolvedValue({
        ...mockQaResult,
        tests_passed: false,
      });

      const result = await service.savePartialResult('exec-1', {
        tests_passed: false,
        test_results: { failed: ['test1'] },
      });

      expect(mockPrismaService.qAResult.update).toHaveBeenCalledWith({
        where: { id: 'qa-result-1' },
        data: expect.objectContaining({
          tests_passed: false,
        }),
      });
      expect(result.tests_passed).toBe(false);
    });

    it('should only update provided fields', async () => {
      mockPrismaService.qAResult.findFirst.mockResolvedValue(mockQaResult);
      mockPrismaService.qAResult.update.mockResolvedValue(mockQaResult);

      await service.savePartialResult('exec-1', {
        test_coverage: 90.5,
      });

      expect(mockPrismaService.qAResult.update).toHaveBeenCalledWith({
        where: { id: 'qa-result-1' },
        data: expect.objectContaining({
          test_coverage: 90.5,
        }),
      });
    });
  });

  describe('create', () => {
    it('should create a new QA result', async () => {
      mockPrismaService.qAResult.findFirst.mockResolvedValue(null);
      mockPrismaService.qAResult.create.mockResolvedValue(mockQaResult);

      const result = await service.create({
        executionId: 'exec-1',
        linting_passed: true,
        tests_passed: true,
        test_coverage: 85.5,
        code_review_passed: true,
        overall_passed: true,
      });

      expect(result.id).toBe('qa-result-1');
      expect(result.overall_passed).toBe(true);
    });

    it('should handle partial data with defaults', async () => {
      mockPrismaService.qAResult.findFirst.mockResolvedValue(null);
      mockPrismaService.qAResult.create.mockResolvedValue({
        ...mockQaResult,
        linting_passed: false,
        tests_passed: false,
        code_review_passed: false,
        overall_passed: false,
      });

      const result = await service.create({
        executionId: 'exec-1',
      });

      expect(result.linting_passed).toBe(false);
    });
  });

  describe('update', () => {
    it('should update specified fields only', async () => {
      mockPrismaService.qAResult.findFirst.mockResolvedValue(mockQaResult);
      mockPrismaService.qAResult.update.mockResolvedValue({
        ...mockQaResult,
        overall_passed: false,
      });

      const result = await service.update('exec-1', {
        overall_passed: false,
      });

      expect(result.overall_passed).toBe(false);
    });

    it('should throw NotFoundException if not found', async () => {
      mockPrismaService.qAResult.findFirst.mockResolvedValue(null);

      await expect(service.update('non-existent', { overall_passed: true })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateOverallStatus', () => {
    it('should update only overall_passed field', async () => {
      mockPrismaService.qAResult.updateMany.mockResolvedValue({ count: 1 });

      await service.updateOverallStatus('exec-1', true);

      expect(mockPrismaService.qAResult.updateMany).toHaveBeenCalledWith({
        where: { execution_id: 'exec-1' },
        data: { overall_passed: true },
      });
    });
  });

  describe('findByExecutionId', () => {
    it('should return result with execution details', async () => {
      mockPrismaService.qAResult.findFirst.mockResolvedValue(mockQaResultWithExecution);

      const result = await service.findByExecutionId('exec-1');

      expect(result.id).toBe('qa-result-1');
      expect(result.execution?.id).toBe('exec-1');
      expect(result.execution?.ticket?.project_id).toBe('project-1');
    });

    it('should throw NotFoundException if not found', async () => {
      mockPrismaService.qAResult.findFirst.mockResolvedValue(null);

      await expect(service.findByExecutionId('non-existent')).rejects.toThrow(NotFoundException);
    });

    it('should track query metrics', async () => {
      mockPrismaService.qAResult.findFirst.mockResolvedValue(mockQaResultWithExecution);

      await service.findByExecutionId('exec-1');

      expect(mockCounter.inc).toHaveBeenCalledWith({ query_type: 'by_execution' });
      expect(mockHistogram.startTimer).toHaveBeenCalledWith({
        query_type: 'by_execution',
      });
    });
  });

  describe('findByTicketId', () => {
    it('should return paginated results for ticket', async () => {
      mockPrismaService.execution.findMany.mockResolvedValue([{ id: 'exec-1' }]);
      mockPrismaService.qAResult.findMany.mockResolvedValue([mockQaResultWithExecution]);
      mockPrismaService.qAResult.count.mockResolvedValue(1);

      const result = await service.findByTicketId('ticket-1');

      expect(result.data).toHaveLength(1);
      expect(result.pageInfo.total).toBe(1);
    });

    it('should filter by status (passed/failed)', async () => {
      mockPrismaService.execution.findMany.mockResolvedValue([{ id: 'exec-1' }]);
      mockPrismaService.qAResult.findMany.mockResolvedValue([mockQaResultWithExecution]);
      mockPrismaService.qAResult.count.mockResolvedValue(1);

      await service.findByTicketId('ticket-1', {
        status: QaResultFilterStatus.PASSED,
      });

      expect(mockPrismaService.qAResult.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            overall_passed: true,
          }),
        }),
      );
    });

    it('should return empty response if no results', async () => {
      mockPrismaService.execution.findMany.mockResolvedValue([]);

      const result = await service.findByTicketId('ticket-1');

      expect(result.data).toHaveLength(0);
      expect(result.pageInfo.total).toBe(0);
    });
  });

  describe('findByProjectId', () => {
    it('should return paginated results for project', async () => {
      mockPrismaService.execution.findMany.mockResolvedValue([{ id: 'exec-1' }]);
      mockPrismaService.qAResult.findMany.mockResolvedValue([mockQaResultWithExecution]);
      mockPrismaService.qAResult.count.mockResolvedValue(1);

      const result = await service.findByProjectId('project-1');

      expect(result.data).toHaveLength(1);
    });

    it('should respect max page size limit', async () => {
      mockPrismaService.execution.findMany.mockResolvedValue([{ id: 'exec-1' }]);
      mockPrismaService.qAResult.findMany.mockResolvedValue([]);
      mockPrismaService.qAResult.count.mockResolvedValue(0);

      await service.findByProjectId('project-1', { limit: 500 });

      expect(mockPrismaService.qAResult.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 100, // Max page size
        }),
      );
    });
  });

  describe('query', () => {
    it('should handle general queries with all filters', async () => {
      mockPrismaService.qAResult.findMany.mockResolvedValue([mockQaResultWithExecution]);
      mockPrismaService.qAResult.count.mockResolvedValue(1);

      const result = await service.query({
        status: QaResultFilterStatus.PASSED,
        startDate: new Date('2025-12-01'),
        endDate: new Date('2025-12-31'),
        page: 1,
        limit: 10,
      });

      expect(result.data).toHaveLength(1);
    });

    it('should track query metrics', async () => {
      mockPrismaService.qAResult.findMany.mockResolvedValue([]);
      mockPrismaService.qAResult.count.mockResolvedValue(0);

      await service.query({});

      expect(mockCounter.inc).toHaveBeenCalledWith({ query_type: 'general' });
    });
  });

  describe('getMetrics', () => {
    const mockResults = [
      {
        overall_passed: true,
        linting_passed: true,
        tests_passed: true,
        code_review_passed: true,
        test_coverage: 85,
        created_at: new Date('2025-12-01'),
      },
      {
        overall_passed: false,
        linting_passed: true,
        tests_passed: false,
        code_review_passed: true,
        test_coverage: 70,
        created_at: new Date('2025-12-01'),
      },
      {
        overall_passed: true,
        linting_passed: true,
        tests_passed: true,
        code_review_passed: true,
        test_coverage: 90,
        created_at: new Date('2025-12-02'),
      },
    ];

    it('should calculate pass rate correctly', async () => {
      mockPrismaService.execution.findMany.mockResolvedValue([
        { id: 'exec-1' },
        { id: 'exec-2' },
        { id: 'exec-3' },
      ]);
      mockPrismaService.qAResult.aggregate.mockResolvedValue({
        _count: { id: 3 },
        _avg: { test_coverage: 81.67 },
      });
      mockPrismaService.qAResult.findMany.mockResolvedValue(mockResults);

      const metrics = await service.getMetrics('project-1');

      expect(metrics.passRate).toBeCloseTo(66.67, 1);
      expect(metrics.passedCount).toBe(2);
      expect(metrics.failedCount).toBe(1);
    });

    it('should calculate average coverage using Prisma aggregate', async () => {
      mockPrismaService.execution.findMany.mockResolvedValue([{ id: 'exec-1' }]);
      mockPrismaService.qAResult.aggregate.mockResolvedValue({
        _count: { id: 3 },
        _avg: { test_coverage: 81.67 },
      });
      mockPrismaService.qAResult.findMany.mockResolvedValue(mockResults);

      const metrics = await service.getMetrics('project-1');

      expect(metrics.averageCoverage).toBeCloseTo(81.67, 1);
    });

    it('should calculate category pass rates', async () => {
      mockPrismaService.execution.findMany.mockResolvedValue([{ id: 'exec-1' }]);
      mockPrismaService.qAResult.aggregate.mockResolvedValue({
        _count: { id: 3 },
        _avg: { test_coverage: 81.67 },
      });
      mockPrismaService.qAResult.findMany.mockResolvedValue(mockResults);

      const metrics = await service.getMetrics('project-1');

      expect(metrics.lintingPassRate).toBe(100); // All passed linting
      expect(metrics.testPassRate).toBeCloseTo(66.67, 1); // 2/3 passed tests
      expect(metrics.securityPassRate).toBe(100); // All passed code review
    });

    it('should return daily trends sorted by date', async () => {
      mockPrismaService.execution.findMany.mockResolvedValue([{ id: 'exec-1' }]);
      mockPrismaService.qAResult.aggregate.mockResolvedValue({
        _count: { id: 3 },
        _avg: { test_coverage: 81.67 },
      });
      mockPrismaService.qAResult.findMany.mockResolvedValue(mockResults);

      const metrics = await service.getMetrics('project-1');

      expect(metrics.trends).toHaveLength(2);
      expect(metrics.trends[0].date).toBe('2025-12-01');
      expect(metrics.trends[1].date).toBe('2025-12-02');
    });

    it('should default to 30 day range if no dates provided', async () => {
      mockPrismaService.execution.findMany.mockResolvedValue([]);

      const metrics = await service.getMetrics('project-1');

      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      expect(metrics.dateRange.start.getTime()).toBeCloseTo(thirtyDaysAgo.getTime(), -4);
    });

    it('should return empty metrics for project with no results', async () => {
      mockPrismaService.execution.findMany.mockResolvedValue([]);

      const metrics = await service.getMetrics('project-1');

      expect(metrics.totalExecutions).toBe(0);
      expect(metrics.passRate).toBe(0);
      expect(metrics.trends).toHaveLength(0);
    });
  });

  describe('overrideQualityGate', () => {
    it('should update QA result to passed and create audit log', async () => {
      mockPrismaService.qAResult.updateMany.mockResolvedValue({ count: 1 });
      mockPrismaService.auditLog.create.mockResolvedValue({ id: 'audit-1' });

      await service.overrideQualityGate('exec-1', 'Urgent hotfix', 'admin-1');

      expect(mockPrismaService.qAResult.updateMany).toHaveBeenCalledWith({
        where: { execution_id: 'exec-1' },
        data: { overall_passed: true },
      });
      expect(mockPrismaService.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          entity_type: 'qa_result',
          entity_id: 'exec-1',
          action: 'quality_gate_override',
          actor_id: 'admin-1',
        }),
      });
    });
  });

  describe('buildPaginatedResponse', () => {
    it('should calculate totalPages correctly', async () => {
      mockPrismaService.qAResult.findMany.mockResolvedValue([]);
      mockPrismaService.qAResult.count.mockResolvedValue(25);

      const result = await service.query({ limit: 10, page: 1 });

      expect(result.pageInfo.totalPages).toBe(3);
    });

    it('should set hasNextPage when more pages exist', async () => {
      mockPrismaService.qAResult.findMany.mockResolvedValue([]);
      mockPrismaService.qAResult.count.mockResolvedValue(25);

      const result = await service.query({ limit: 10, page: 1 });

      expect(result.pageInfo.hasNextPage).toBe(true);
    });

    it('should set hasPreviousPage when on page > 1', async () => {
      mockPrismaService.qAResult.findMany.mockResolvedValue([]);
      mockPrismaService.qAResult.count.mockResolvedValue(25);

      const result = await service.query({ limit: 10, page: 2 });

      expect(result.pageInfo.hasPreviousPage).toBe(true);
    });
  });

  describe('legacy methods', () => {
    it('getResult should return result mapped to interface', async () => {
      mockPrismaService.qAResult.findFirst.mockResolvedValue(mockQaResult);

      const result = await service.getResult('exec-1');

      expect(result.id).toBe('qa-result-1');
    });

    it('getResultsByTicket should return array of results', async () => {
      mockPrismaService.execution.findMany.mockResolvedValue([{ id: 'exec-1' }]);
      mockPrismaService.qAResult.findMany.mockResolvedValue([mockQaResult]);

      const results = await service.getResultsByTicket('ticket-1');

      expect(results).toHaveLength(1);
      expect(Array.isArray(results)).toBe(true);
    });

    it('getResultsByProject should filter by status', async () => {
      mockPrismaService.ticket.findMany.mockResolvedValue([{ id: 'ticket-1' }]);
      mockPrismaService.execution.findMany.mockResolvedValue([{ id: 'exec-1' }]);
      mockPrismaService.qAResult.findMany.mockResolvedValue([mockQaResult]);

      await service.getResultsByProject('project-1', {
        status: 'passed',
      });

      expect(mockPrismaService.qAResult.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            overall_passed: true,
          }),
        }),
      );
    });
  });
});
