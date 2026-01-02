import { Injectable, Logger } from '@nestjs/common';
import { TaskType } from '@/prisma/client';
import { AiCapabilityService } from './ai-capability.service';

/**
 * Helper service to track AI execution capabilities (Story 7.7 C2 fix)
 *
 * This service provides a safe wrapper for capability tracking that can be injected
 * into execution consumers without complex dependencies. It infers task types from
 * prompts and handles all errors gracefully.
 */
@Injectable()
export class AiCapabilityTrackerService {
  private readonly logger = new Logger(AiCapabilityTrackerService.name);

  constructor(private readonly aiCapability: AiCapabilityService) {}

  /**
   * Track an execution result with automatic task type inference
   * @param success - Whether the execution succeeded
   * @param prompt - The prompt used (for task type inference)
   * @param taskType - Optional explicit task type (overrides inference)
   * @param errorDetails - error details if failed
   */
  async trackExecution(
    success: boolean,
    prompt?: string,
    taskType?: TaskType,
    errorDetails?: string,
  ): Promise<void> {
    try {
      const inferredTaskType = taskType || this.inferTaskTypeFromPrompt(prompt || '');
      await this.aiCapability.trackExecutionResult(inferredTaskType, success, errorDetails);

      this.logger.debug(
        `Capability tracked: ${inferredTaskType} ${success ? 'SUCCESS' : 'FAILURE'}${errorDetails ? ` - ${errorDetails}` : ''}`,
      );
    } catch (error) {
      const err = error as Error;
      this.logger.warn(`Failed to track capability: ${err.message}`);
      // Never throw - capability tracking is non-critical
    }
  }

  /**
   * Infer task type based on prompt keywords
   */
  private inferTaskTypeFromPrompt(prompt: string): TaskType {
    const lowerPrompt = prompt.toLowerCase();

    // Test generation patterns
    if (
      lowerPrompt.includes('write test') ||
      lowerPrompt.includes('test case') ||
      lowerPrompt.includes('unit test') ||
      lowerPrompt.includes('integration test') ||
      lowerPrompt.includes('generate tests')
    ) {
      return TaskType.TEST_GENERATION;
    }

    // Refactoring patterns
    if (
      lowerPrompt.includes('refactor') ||
      lowerPrompt.includes('improve code') ||
      lowerPrompt.includes('optimize') ||
      lowerPrompt.includes('clean up')
    ) {
      return TaskType.REFACTORING;
    }

    // Documentation patterns
    if (
      lowerPrompt.includes('document') ||
      lowerPrompt.includes('add comments') ||
      lowerPrompt.includes('generate docs') ||
      lowerPrompt.includes('readme') ||
      lowerPrompt.includes('api docs')
    ) {
      return TaskType.DOCUMENTATION;
    }

    // Architecture review patterns
    if (
      lowerPrompt.includes('architecture') ||
      lowerPrompt.includes('design decision') ||
      lowerPrompt.includes('adr') ||
      lowerPrompt.includes('review design')
    ) {
      return TaskType.ARCHITECTURE_REVIEW;
    }

    // Bug fix patterns
    if (
      lowerPrompt.includes('fix bug') ||
      lowerPrompt.includes('fix error') ||
      lowerPrompt.includes('resolve issue') ||
      lowerPrompt.includes('debug')
    ) {
      return TaskType.BUG_FIX;
    }

    // Default: code generation (most common task)
    return TaskType.CODE_GENERATION;
  }
}
