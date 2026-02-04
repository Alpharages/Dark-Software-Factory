import { Injectable } from '@nestjs/common';
import { ProductionError, QAResult, QaReviewQueue, EscapeCategory } from '@/prisma/client';

@Injectable()
export class BugEscapeAnalyzer {
  /**
   * Determine the root cause category for a bug escape.
   */
  determineEscapeCategory(
    error: ProductionError,
    qaResult?: QAResult | null,
    reviewQueue?: QaReviewQueue | null,
  ): EscapeCategory {
    // 1. No QA result - likely an issue but without QA data we can't blame QA process specifically (or it bypassed QA entirely)
    // If it bypassed QA, that's a process failure, but here we assume it passed QA if it's an escape.
    // If qaResult is missing but ticket passed, maybe UNKNOWN or check if it was manually bypassed.
    if (!qaResult) {
      // If manual review happened and approved, but no automated QA? That's weird.
      if (reviewQueue?.status === 'APPROVED') {
        return EscapeCategory.REVIEW_FAILURE;
      }
      return EscapeCategory.UNKNOWN;
    }

    // 2. Extract affected files from stack trace
    const affectedFiles = this.extractFilesFromStackTrace(error.stack_trace);

    // 3. Check coverage blindspot
    // Cast to expected type - depends on how coverage is stored in Json.
    // Assuming coverage: { covered_files: string[], percentage: number } based on story.
    // const coverageData = qaResult.test_results as any; // Using valid property. Wait, qaResult has `test_results` and `linting_errors`.

    // 4. Check test gaps
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const testResults = qaResult.test_results as Record<string, any>;
    if (testResults && typeof testResults === 'object') {
      // Mock logic matching story as closely as possible given schema constraints
      const testedFiles = testResults.test_files || [];
      if (affectedFiles.length > 0 && testedFiles.length > 0) {
        const hasTestsButFailed = affectedFiles.some((f) =>
          testedFiles.some((tf: string) => f.includes(tf) || tf.includes(f)),
        );
        // If we have tests for these files, but they passed (failed_tests is empty), it's a gap in test scenarios.
        if (
          hasTestsButFailed &&
          (!testResults.failed_tests || testResults.failed_tests.length === 0)
        ) {
          return EscapeCategory.TEST_GAP;
        }
      }
    }

    // 5. Check linting misses
    // If linting passed but it's a logic error
    if (qaResult.linting_passed && this.isLogicError(error)) {
      return EscapeCategory.LINTING_MISS;
    }

    // 6. Check manual review failure
    if (reviewQueue?.status === 'APPROVED') {
      return EscapeCategory.REVIEW_FAILURE;
    }

    // 7. Check for dependency/environment patterns
    if (this.isDependencyError(error)) {
      return EscapeCategory.DEPENDENCY_ISSUE;
    }
    if (this.isEnvironmentError(error)) {
      return EscapeCategory.ENVIRONMENT_DIFFERENCE;
    }

    // Default to unknown
    return EscapeCategory.UNKNOWN;
  }

  // Helper: Extract file paths from stack trace
  private extractFilesFromStackTrace(stackTrace?: string | null): string[] {
    if (!stackTrace) return [];
    const fileRegex = /(?:at\s+.*?\s+\()?([^\s(]+\.(?:ts|js|tsx|jsx)):\d+:\d+\)?/g;
    const matches = [...stackTrace.matchAll(fileRegex)];
    return [...new Set(matches.map((m) => m[1]))];
  }

  // Helper: Check if error is a logic error
  private isLogicError(error: ProductionError): boolean {
    const logicPatterns = [
      /TypeError.*undefined/i,
      /TypeError.*null/i,
      /ReferenceError.*is not defined/i,
      /AssertionError/i,
    ];
    // error_message is guaranteed by schema
    return logicPatterns.some((p) => p.test(error.error_message));
  }

  // Helper: Check for dependency-related errors
  private isDependencyError(error: ProductionError): boolean {
    const depPatterns = [
      /MODULE_NOT_FOUND/i,
      /Cannot find module/i,
      /Error: Cannot resolve/i,
      /npm ERR/i,
    ];
    return depPatterns.some((p) => p.test(error.error_message));
  }

  // Helper: Check for environment-specific errors
  private isEnvironmentError(error: ProductionError): boolean {
    const envPatterns = [
      /ECONNREFUSED.*localhost/i,
      /ENOTFOUND.*internal/i,
      /ENV.*not set/i,
      /process\.env/i,
    ];
    return envPatterns.some((p) => p.test(error.error_message));
  }
}
