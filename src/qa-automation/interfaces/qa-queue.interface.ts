/**
 * QA Queue Message Interfaces (Story 3.7)
 * Enhanced QA check message with code files for post-execution QA
 */

export interface ICodeFile {
  path: string;
  content: string;
  originalContent?: string;
  language?: 'typescript' | 'javascript' | 'python' | 'go' | 'unknown';
}

export interface IQaQueueMessage {
  executionId: string;
  ticketId: string;
  projectId: string;
  codeFiles: ICodeFile[];
  aiProvider: string;
  correlationId: string;
  completedAt: string;
}

export interface IQaQueueResult {
  executionId: string;
  passed: boolean;
  results: {
    linting: { passed: boolean; errors: unknown[]; duration: number };
    testing: { passed: boolean; results: unknown; duration: number };
    coverage: { percentage: number | null; passed: boolean; duration: number };
    security: { passed: boolean; issues: unknown[]; duration: number };
  };
  totalDuration: number;
  correlationId: string;
}

export type QaCheckType = 'linting' | 'testing' | 'coverage' | 'security';
