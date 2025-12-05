/**
 * QA Results Storage & Retrieval Interfaces
 * Story 3.6: FR38 - Lead QA can view automated QA results
 * Architecture: docs/architecture.md line 1642 (QAResult model)
 */

/**
 * Filter status for QA results queries
 */
export enum QaResultFilterStatus {
  ALL = 'all',
  PASSED = 'passed',
  FAILED = 'failed',
}

/**
 * Full creation input - used internally by create()
 */
export interface IQaResultCreate {
  executionId: string;
  linting_passed?: boolean;
  linting_errors?: Record<string, unknown>;
  tests_passed?: boolean;
  test_results?: Record<string, unknown>;
  test_coverage?: number | null;
  code_review_passed?: boolean;
  code_review_issues?: Record<string, unknown>;
  overall_passed?: boolean;
}

/**
 * Partial update input - used by Stories 3.1-3.4 via savePartialResult()
 * Each story updates only their relevant fields
 */
export interface IQaResultPartial {
  linting_passed?: boolean;
  linting_errors?: Record<string, unknown>;
  tests_passed?: boolean;
  test_results?: Record<string, unknown>;
  test_coverage?: number | null;
  code_review_passed?: boolean;
  code_review_issues?: Record<string, unknown>;
}

export interface IQaResultUpdate extends IQaResultPartial {
  overall_passed?: boolean;
}

export interface IQaResultQuery {
  ticketId?: string;
  projectId?: string;
  status?: QaResultFilterStatus;
  startDate?: Date;
  endDate?: Date;
  page?: number;
  limit?: number;
}

export interface IQaResult {
  id: string;
  execution_id: string;
  linting_passed: boolean;
  linting_errors: Record<string, unknown> | null;
  tests_passed: boolean;
  test_results: Record<string, unknown> | null;
  test_coverage: number | null;
  code_review_passed: boolean;
  code_review_issues: Record<string, unknown> | null;
  overall_passed: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface IQaResultWithExecution extends IQaResult {
  execution?: {
    id: string;
    ticket_id: string;
    ai_provider: string;
    status: string;
    ticket?: {
      id: string;
      title: string;
      project_id: string;
      clickup_task_id: string;
    };
  };
}

export interface IPageInfo {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface IQaResultsPageResponse {
  data: IQaResultWithExecution[];
  pageInfo: IPageInfo;
}

export interface ITrendData {
  date: string;
  passed: number;
  failed: number;
  coverage: number;
}

export interface IQaResultMetrics {
  projectId: string;
  dateRange: {
    start: Date;
    end: Date;
  };
  totalExecutions: number;
  passedCount: number;
  failedCount: number;
  passRate: number;
  averageCoverage: number;
  lintingPassRate: number;
  testPassRate: number;
  securityPassRate: number;
  trends: ITrendData[];
}
