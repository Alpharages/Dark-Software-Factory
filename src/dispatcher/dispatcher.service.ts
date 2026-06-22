import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ExecutionStatus, PMProvider } from '@/prisma/client';
import { PrismaService } from '@/database/prisma.service';
import { normalizeStatus } from '@/config/status-skill-map.config';
import { OpenHarnessRunnerService } from '@/openharness/openharness-runner.service';
import { StatusSkillMapService } from '@/openharness/status-skill-map.service';
import { ITaskEvent, TaskProviderType } from '@/ticket-intake/dto';

export type DispatchResult =
  | { dispatched: true; executionId: string; skill: string }
  | {
      dispatched: false;
      reason: 'missing-status' | 'ticket-not-found' | 'no-mapping' | 'active-execution' | 'error';
      executionId?: string;
      error?: string;
      skill?: string;
    };

@Injectable()
export class DispatcherService {
  private readonly logger = new Logger(DispatcherService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly statusSkillMap: StatusSkillMapService,
    private readonly runner: OpenHarnessRunnerService,
    private readonly configService: ConfigService,
  ) {}

  async dispatch(event: ITaskEvent): Promise<DispatchResult> {
    const status = event.originalProviderStatus;
    if (!status) {
      this.logger.debug(`[${event.correlationId}] Dispatch skipped: missing provider status`);
      return { dispatched: false, reason: 'missing-status' };
    }

    const ticket = await this.prisma.ticket.findUnique({
      where: { clickup_task_id: event.externalId },
      select: {
        id: true,
        project: {
          select: {
            integrations: {
              where: this.providerWhere(event),
              select: { provider: true, ai_trigger_status: true },
            },
          },
        },
      },
    });

    if (!ticket) {
      this.logger.debug(
        `[${event.correlationId}] Dispatch skipped: no ticket for ${event.externalId}`,
      );
      return { dispatched: false, reason: 'ticket-not-found' };
    }

    const skill =
      this.statusSkillMap.resolveSkill(status) ??
      (this.isProjectTrigger(status, ticket.project.integrations[0]?.ai_trigger_status)
        ? this.requiredConfig('openharness.defaultSkill')
        : null);

    if (!skill) {
      this.logger.debug(
        `[${event.correlationId}] Dispatch skipped: no skill mapping for ${event.externalId} status ${status}`,
      );
      return { dispatched: false, reason: 'no-mapping' };
    }

    const activeExecution = await this.prisma.execution.findFirst({
      where: {
        ticket: { clickup_task_id: event.externalId },
        status: { in: [ExecutionStatus.QUEUED, ExecutionStatus.IN_PROGRESS] },
      },
      select: { id: true },
    });

    if (activeExecution) {
      this.logger.debug(
        `[${event.correlationId}] Dispatch skipped: active execution ${activeExecution.id} for ${event.externalId}`,
      );
      return {
        dispatched: false,
        reason: 'active-execution',
        executionId: activeExecution.id,
      };
    }

    try {
      const executionId = await this.runner.runForTicket(ticket.id, {
        skill,
        workspaceDir: this.requiredConfig('openharness.workspaceDir'),
      });
      this.logger.log(
        `[${event.correlationId}] Dispatched ${event.externalId} to OpenHarness skill ${skill} (${executionId})`,
      );
      return { dispatched: true, executionId, skill };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[${event.correlationId}] Dispatch failed for ${event.externalId}: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      return { dispatched: false, reason: 'error', error: message, skill };
    }
  }

  private providerWhere(event: ITaskEvent): { provider?: PMProvider } {
    if (event.providerType === TaskProviderType.CLICKUP) {
      return { provider: PMProvider.CLICKUP };
    }
    return {};
  }

  private isProjectTrigger(status: string, triggerStatus: string | null | undefined): boolean {
    return !!triggerStatus && normalizeStatus(status) === normalizeStatus(triggerStatus);
  }

  private requiredConfig(key: string): string {
    const value = this.configService.get<string>(key);
    if (!value) {
      throw new Error(`Missing required config: ${key}`);
    }
    return value;
  }
}
