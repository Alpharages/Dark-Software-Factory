import { Injectable, Logger } from '@nestjs/common';
import { IParsedTicket } from './interfaces';
import { ValidationResultDto, ValidationErrorDto } from './dto';

/**
 * Ticket Validation Service
 * FR58: Validate ticket quality
 *
 * Validates ticket data against quality requirements:
 * - Title min 10 characters
 * - Description min 50 characters
 * - Acceptance criteria required (min 20 chars)
 * - Project ID required
 */
@Injectable()
export class TicketValidatorService {
  private readonly logger = new Logger(TicketValidatorService.name);
  private readonly MIN_TITLE_LENGTH = 10;
  private readonly MIN_DESCRIPTION_LENGTH = 50;
  private readonly MIN_AC_LENGTH = 20;

  /**
   * Validate a parsed ticket against quality requirements
   */
  async validate(ticket: IParsedTicket, correlationId: string): Promise<ValidationResultDto> {
    this.logger.log(`[${correlationId}] Validating ticket: ${ticket.clickupTaskId}`);
    const errors: ValidationErrorDto[] = [];
    const warnings: ValidationErrorDto[] = [];

    this.validateTitle(ticket.title, errors, warnings);
    this.validateDescription(ticket.description, errors, warnings);
    this.validateAcceptanceCriteria(ticket.acceptanceCriteria, errors, warnings);
    this.validateProjectId(ticket.projectId, errors);

    const isValid = errors.length === 0;
    this.logger.log(
      `[${correlationId}] Validation ${isValid ? 'PASSED' : 'FAILED'}: ${errors.length} errors, ${warnings.length} warnings`,
    );

    // Return result with warnings even if validation passes
    const result = new ValidationResultDto();
    result.isValid = isValid;
    result.errors = errors;
    result.warnings = warnings;
    return result;
  }

  /**
   * Validate ticket title
   */
  private validateTitle(
    title: string,
    errors: ValidationErrorDto[],
    warnings: ValidationErrorDto[],
  ): void {
    if (!title?.trim()) {
      errors.push({
        field: 'title',
        code: 'TITLE_REQUIRED',
        message: 'Ticket title is required',
        severity: 'error',
      });
      return;
    }

    if (title.trim().length < this.MIN_TITLE_LENGTH) {
      errors.push({
        field: 'title',
        code: 'TITLE_TOO_SHORT',
        message: `Title must be at least ${this.MIN_TITLE_LENGTH} characters`,
        severity: 'error',
      });
    }

    // Warn on generic titles
    if (/^(todo|fix|test|bug|issue)\b/i.test(title)) {
      warnings.push({
        field: 'title',
        code: 'TITLE_GENERIC',
        message: 'Use a more descriptive title instead of generic prefixes',
        severity: 'warning',
      });
    }
  }

  /**
   * Validate ticket description
   */
  private validateDescription(
    desc: string,
    errors: ValidationErrorDto[],
    warnings: ValidationErrorDto[],
  ): void {
    if (!desc?.trim()) {
      errors.push({
        field: 'description',
        code: 'DESC_REQUIRED',
        message: 'Description is required',
        severity: 'error',
      });
      return;
    }

    if (desc.trim().length < this.MIN_DESCRIPTION_LENGTH) {
      errors.push({
        field: 'description',
        code: 'DESC_TOO_SHORT',
        message: `Description must be at least ${this.MIN_DESCRIPTION_LENGTH} characters`,
        severity: 'error',
      });
    }

    // Suggest adding reasoning
    if (!/\b(because|so that|in order to)\b/i.test(desc)) {
      warnings.push({
        field: 'description',
        code: 'DESC_NO_REASONING',
        message: 'Consider explaining WHY this feature/fix is needed',
        severity: 'warning',
      });
    }
  }

  /**
   * Validate acceptance criteria
   */
  private validateAcceptanceCriteria(
    ac: string,
    errors: ValidationErrorDto[],
    warnings: ValidationErrorDto[],
  ): void {
    if (!ac?.trim()) {
      errors.push({
        field: 'acceptance_criteria',
        code: 'AC_REQUIRED',
        message: 'Acceptance criteria are required',
        severity: 'error',
      });
      return;
    }

    if (ac.trim().length < this.MIN_AC_LENGTH) {
      errors.push({
        field: 'acceptance_criteria',
        code: 'AC_TOO_SHORT',
        message: `Acceptance criteria must be at least ${this.MIN_AC_LENGTH} characters`,
        severity: 'error',
      });
    }

    // Suggest BDD format if not present
    const hasGWT = ac.toLowerCase().includes('given') && ac.toLowerCase().includes('then');
    if (!hasGWT) {
      warnings.push({
        field: 'acceptance_criteria',
        code: 'AC_NOT_BDD',
        message: 'Use Given/When/Then format for clearer acceptance criteria',
        severity: 'warning',
      });
    }
  }

  /**
   * Validate project ID
   */
  private validateProjectId(projectId: string, errors: ValidationErrorDto[]): void {
    if (!projectId?.trim()) {
      errors.push({
        field: 'project_id',
        code: 'PROJECT_REQUIRED',
        message: 'Project ID is required',
        severity: 'error',
      });
    }
  }

  /**
   * Format validation errors for ClickUp comment
   */
  formatErrorsForComment(result: ValidationResultDto): string {
    const lines = ['❌ **Ticket Validation Failed**\n'];

    if (result.errors.length > 0) {
      lines.push('**Errors (must fix):**');
      result.errors.forEach((e, i) => lines.push(`${i + 1}. **${e.field}**: ${e.message}`));
    }

    if (result.warnings.length > 0) {
      lines.push('\n**Suggestions (recommended):**');
      result.warnings.forEach((w) => lines.push(`- ${w.message}`));
    }

    lines.push('\n---\n_Please update the ticket and it will be automatically re-validated._');
    return lines.join('\n');
  }
}
