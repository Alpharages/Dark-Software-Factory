import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { ClickUpService } from '@/clickup/clickup.service';
import { SystemConfigService } from '@/system-settings/system-config.service';
import { SentryService } from '@/common/sentry/sentry.service';
import { ProductionErrorModel as ProductionError, ProjectModel as Project } from '@/prisma/models';
import { ErrorSeverity } from '@/prisma/enums';
import { CreateFixTicketDto } from './dto/create-fix-ticket.dto';
import { FixTicketMetrics } from './fix-ticket.metrics';

@Injectable()
export class FixTicketService {
  private readonly logger = new Logger(FixTicketService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clickup: ClickUpService,
    private readonly config: SystemConfigService,
    private readonly sentry: SentryService,
    private readonly metrics: FixTicketMetrics,
  ) {}

  /**
   * Determine if a ticket should be created based on severity threshold
   */
  async shouldCreateTicket(severity: ErrorSeverity): Promise<boolean> {
    const thresholdStr = await this.config.get('AUTO_TICKET_SEVERITY_THRESHOLD', 'HIGH');
    const severities = Object.values(ErrorSeverity);
    const thresholdIndex = severities.indexOf(thresholdStr as ErrorSeverity);
    const severityIndex = severities.indexOf(severity);

    // ErrorSeverity: CRITICAL=0, HIGH=1, MEDIUM=2, LOW=3 (lower index is more severe)
    return severityIndex <= thresholdIndex;
  }

  /**
   * Check for existing tickets for the same application and error type within 24 hours
   */
  async checkForDuplicates(application: string, errorType: string): Promise<string | null> {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const existingError = await this.prisma.productionError.findFirst({
      where: {
        application,
        error_type: errorType,
        fix_ticket_id: { not: null },
        occurred_at: { gte: twentyFourHoursAgo },
      },
      select: { fix_ticket_id: true },
    });

    return existingError?.fix_ticket_id || null;
  }

  /**
   * Resolve the target ClickUp list ID for the error
   */
  async resolveTargetList(application: string): Promise<{ listId: string; project?: Project }> {
    // Try to find project by application name (case-insensitive)
    const project = await this.prisma.project.findFirst({
      where: {
        name: { equals: application, mode: 'insensitive' },
      },
    });

    if (project?.clickup_list_id) {
      return { listId: project.clickup_list_id, project };
    }

    // Fallback to default list
    const defaultListId = await this.config.get('DEFAULT_PRODUCTION_ERRORS_LIST_ID');
    if (!defaultListId) {
      throw new Error('DEFAULT_PRODUCTION_ERRORS_LIST_ID is not configured');
    }

    return { listId: defaultListId, project: project || undefined };
  }

  /**
   * Resolve the assignee for the ticket
   */
  async resolveAssignee(project?: Project): Promise<number | null> {
    // Use project PM if available
    if (project?.pm_id) {
      // Assuming pm_id stores the ClickUp numeric user ID as a string
      const pmIdNum = parseInt(project.pm_id, 10);
      if (!isNaN(pmIdNum)) {
        return pmIdNum;
      }
    }

    // Fallback to default ops assignee
    const defaultAssigneeId = await this.config.get('DEFAULT_OPS_ASSIGNEE_ID');
    if (defaultAssigneeId) {
      const assigneeIdNum = parseInt(defaultAssigneeId, 10);
      if (!isNaN(assigneeIdNum)) {
        return assigneeIdNum;
      }
    }

    return null;
  }

  /**
   * Map internal severity to ClickUp priority
   */
  private mapSeverityToPriority(severity: ErrorSeverity): number {
    switch (severity) {
      case ErrorSeverity.CRITICAL:
        return 1; // Urgent
      case ErrorSeverity.HIGH:
        return 2; // High
      case ErrorSeverity.MEDIUM:
        return 3; // Normal
      case ErrorSeverity.LOW:
        return 4; // Low
      default:
        return 3;
    }
  }

  /**
   * Sanitize tag names (alphanumeric + hyphens only)
   */
  private sanitizeTag(tag: string): string {
    return tag
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  /**
   * Build the ClickUp ticket content
   */
  buildTicketContent(error: ProductionError, frontendUrl: string): CreateFixTicketDto {
    const truncatedMessage =
      error.error_message.length > 100
        ? error.error_message.substring(0, 97) + '...'
        : error.error_message;

    const taskName = `[PROD ERROR] ${error.application} - ${error.error_type}: ${truncatedMessage}`;

    const errorDetailUrl = `${frontendUrl}/production-errors/${error.id}`;

    // Improved description with Error ID prominently displayed
    const description = `
# Production Error - ID: ${error.id}

**Application:** ${error.application}
**Error Type:** ${error.error_type}
**Severity:** ${error.severity}
**Occurred At:** ${error.occurred_at.toISOString()}
**Error ID:** ${error.id}
**Log Link:** [View in DSF](${errorDetailUrl})

## Message
\`\`\`
${error.error_message}
\`\`\`

## Stack Trace
\`\`\`
${error.stack_trace || 'N/A'}
\`\`\`

---
*Created automatically by DSF Production Monitoring*
    `.trim();

    // Sanitize tags (M2)
    const tags = [
      this.sanitizeTag('production-error'),
      this.sanitizeTag(error.application),
      this.sanitizeTag(error.severity),
    ];

    return {
      name: taskName,
      description,
      priority: this.mapSeverityToPriority(error.severity),
      tags,
    };
  }

  /**
   * Main entry point for creating a fix ticket
   */
  async processError(
    errorId: string,
    correlationId: string = 'fix-ticket-creation',
    executionId?: string,
  ): Promise<string | null> {
    const error = await this.prisma.productionError.findUnique({
      where: { id: errorId },
    });

    if (!error) {
      this.logger.error(`Error ${errorId} not found for ticket creation`, { correlationId });
      return null;
    }

    let decisionReasoning = '';
    let status = 'SKIPPED';

    try {
      // 1. Check severity threshold
      if (!(await this.shouldCreateTicket(error.severity))) {
        decisionReasoning = `Severity ${error.severity} is below threshold.`;
        this.logger.log(`Skipping ticket creation for error ${errorId}: ${decisionReasoning}`, {
          correlationId,
        });
        this.metrics.recordTicketSkipped('threshold', error.severity);
        await this.logDecision(error, decisionReasoning, status, correlationId, executionId);
        return null;
      }

      // 2. Check for duplicates
      const existingTicketId = await this.checkForDuplicates(error.application, error.error_type);
      if (existingTicketId) {
        decisionReasoning = `Duplicate identified within 24h: ${existingTicketId}`;
        this.logger.log(`Skipping ticket creation for error ${errorId}: ${decisionReasoning}`, {
          correlationId,
        });
        this.metrics.recordTicketSkipped('duplicate', error.severity);
        await this.logDecision(error, decisionReasoning, status, correlationId, executionId);
        return null;
      }

      // 3. Resolve destination
      const { listId, project } = await this.resolveTargetList(error.application);
      const assigneeId = await this.resolveAssignee(project);

      // 4. Build content
      const frontendUrl = await this.config.get('FRONTEND_URL');
      if (!frontendUrl) {
        throw new Error('FRONTEND_URL is not configured - cannot generate error detail links');
      }
      const ticketDto = this.buildTicketContent(error, frontendUrl);
      if (assigneeId) {
        ticketDto.assignees = [assigneeId];
      }

      // 5. Create ticket (with rate limit handling - M3)
      this.logger.log(`Creating ClickUp ticket for error ${errorId} in list ${listId}`, {
        correlationId,
      });
      const createdTask = await this.clickup.createTask(listId, ticketDto, { correlationId });

      if (!createdTask) {
        decisionReasoning = 'Failed to create ClickUp task (API error)';
        status = 'FAILED';
        this.metrics.recordTicketFailed('api_error', error.severity);
        throw new Error(decisionReasoning);
      }

      // 6. Update local record
      const ticketUrl = `https://app.clickup.com/t/${createdTask.id}`;
      await this.prisma.productionError.update({
        where: { id: errorId },
        data: {
          fix_ticket_id: createdTask.id,
          fix_ticket_url: ticketUrl,
        },
      });

      decisionReasoning = `Ticket created: ${createdTask.id}`;
      status = 'SUCCESS';
      this.metrics.recordTicketCreated(error.severity, error.application);
      await this.logDecision(error, decisionReasoning, status, correlationId, executionId, {
        list_id: listId,
        assigned_to: assigneeId,
        ticket_id: createdTask.id,
      });

      return createdTask.id;
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const errorType = err instanceof Error ? err.constructor.name : 'UnknownError';
      this.logger.error(`Failed to process error ${errorId} for ticket creation`, {
        correlationId,
        error: errorMsg,
      });

      this.sentry.captureException(err instanceof Error ? err : new Error(errorMsg), {
        extra: { errorId, correlationId, executionId },
      });

      if (status !== 'SUCCESS') {
        this.metrics.recordTicketFailed(errorType, error.severity);
        await this.logDecision(
          error,
          decisionReasoning || errorMsg,
          'FAILED',
          correlationId,
          executionId,
        );
      }

      throw err; // Re-throw for consumer retry
    }
  }

  /**
   * Log decision to ai_decision_logs (H6 - added execution_id)
   */
  private async logDecision(
    error: ProductionError,
    reasoning: string,
    status: string,
    correlationId: string,
    executionId?: string,
    outputData: Record<string, unknown> = {},
  ): Promise<void> {
    try {
      await this.prisma.aIDecisionLog.create({
        data: {
          agent_name: 'FixTicketService',
          action: 'CREATE_FIX_TICKET',
          reasoning,
          ticket_id: error.id, // Using error ID as ticket_id since it's just a string field
          execution_id: executionId || null,
          confidence: 1.0,
          input_data: {
            error_id: error.id,
            application: error.application,
            error_type: error.error_type,
            severity: error.severity,
            correlation_id: correlationId,
            execution_id: executionId,
          },
          output_data: {
            status,
            ...outputData,
          },
        },
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error('Failed to log AI decision', { error: errorMsg });
    }
  }
}
