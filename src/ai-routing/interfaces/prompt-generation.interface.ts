/**
 * Prompt Generation Interfaces
 * FR61: System converts tickets to AI-executable prompts
 * Architecture Reference: Multi-Provider Prompt Engineering
 */

import { AIProvider } from '@/prisma/client';
import { IComplexityBreakdown } from './ai-routing.interface';

// ⚠️ NOTE: This import requires Story 2.3's ai-routing.interface.ts to exist.
// If import fails, Story 2.3 is not complete - see Step 0.

/**
 * Input for prompt generation (from ai-execution-queue)
 * This is the output of Story 2.3 routing
 */
export interface IPromptGenerationInput {
  correlationId: string;
  ticketId: string;
  clickupTaskId: string;
  provider: AIProvider;
  complexityScore: number;
  complexityBreakdown: IComplexityBreakdown;
  title: string;
  description: string;
  acceptanceCriteria: string;
  projectId: string;
  tags: string[];
  routedAt: string;
}

/**
 * Project context for prompt enrichment
 */
export interface IProjectContext {
  projectName: string;
  techStack: string[];
  codingStandards: string[];
  fileStructure: string;
  dependencies: string[];
  relevantFiles: IRelevantFile[];
}

/**
 * Relevant file with content for Claude prompts
 */
export interface IRelevantFile {
  path: string;
  content?: string; // Only populated for Claude Code (inline context)
  description?: string; // What this file does
  linesOfCode?: number;
}

/**
 * Generated prompt result
 */
export interface IGeneratedPrompt {
  correlationId: string;
  ticketId: string;
  provider: AIProvider;

  /** The final prompt string to send to AI */
  prompt: string;

  /** Prompt metadata */
  metadata: IPromptMetadata;
}

/**
 * Prompt metadata for tracking and optimization
 */
export interface IPromptMetadata {
  /** Prompt character length */
  promptLength: number;

  /** Estimated token count (chars / 4 approximation) */
  estimatedTokens: number;

  /** Number of sections included */
  sectionsIncluded: string[];

  /** Whether context files were included inline */
  contextFilesIncluded: boolean;

  /** Number of relevant files referenced */
  relevantFilesCount: number;

  /** Generation timestamp */
  generatedAt: Date;

  /** Template version used */
  templateVersion: string;
}

/**
 * Prompt template sections enum
 */
export enum PromptSection {
  TASK_TITLE = 'task_title',
  DESCRIPTION = 'description',
  ACCEPTANCE_CRITERIA = 'acceptance_criteria',
  TECHNICAL_REQUIREMENTS = 'technical_requirements',
  PROJECT_CONTEXT = 'project_context',
  RELEVANT_FILES = 'relevant_files',
  CODE_STANDARDS = 'code_standards',
  OUTPUT_FORMAT = 'output_format',
  PR_RISK_ASSESSMENT = 'pr_risk_assessment',
}

/**
 * Provider-specific prompt configuration
 */
export interface IProviderPromptConfig {
  provider: AIProvider;
  maxTokens: number;
  includeFileContents: boolean;
  emphasisPatterns: string[];
  outputFormat: string;
}

/**
 * Prompt builder strategy interface
 */
export interface IPromptBuilder {
  /** Provider this builder is for */
  readonly provider: AIProvider;

  /** Max token limit for this provider */
  readonly maxTokens: number;

  /** Build the prompt from input and context */
  build(input: IPromptGenerationInput, context?: IProjectContext): string;

  /** Estimate token count */
  estimateTokens(prompt: string): number;

  /** Truncate prompt if exceeds limit */
  truncateIfNeeded(prompt: string): string;
}
