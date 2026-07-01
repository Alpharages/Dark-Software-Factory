import { Injectable } from '@nestjs/common';
import { MetricsService } from '@/common/metrics/metrics.service';
import { LoggerService } from '@/common/logger/logger.service';
import { StatusSkillMapService } from '@/openharness/status-skill-map.service';

export interface DevelopmentGateDecision {
  allowed: boolean;
  reason: 'allowed' | 'mapped_status' | 'trigger_not_configured' | 'status_mismatch';
}

interface GateIntegration {
  ai_trigger_status: string | null;
  provider: string;
  project_id: string;
}

@Injectable()
export class DevelopmentGateService {
  constructor(
    private readonly metrics: MetricsService,
    private readonly logger: LoggerService,
    private readonly statusSkillMap: StatusSkillMapService,
  ) {}

  /**
   * FR-CS20: Development gate — compare task status against ai_trigger_status.
   * Project-aware mapped-status lookup may read DB-backed override rows.
   *
   * @param taskId     - External task ID (for logging)
   * @param taskStatus - Raw status string from PM provider
   * @param integration - Resolved ProjectIntegration (partial — only fields needed)
   * @param source     - 'webhook' | 'polling' (affects which counter is incremented on mismatch)
   * @param correlationId - For structured logging
   */
  async check(
    taskId: string,
    taskStatus: string,
    integration: GateIntegration,
    source: 'webhook' | 'polling',
    correlationId: string,
  ): Promise<DevelopmentGateDecision> {
    const { ai_trigger_status, provider, project_id } = integration;
    const mappedSkill = await this.statusSkillMap.resolveSkill(taskStatus, project_id);
    if (mappedSkill) {
      return { allowed: true, reason: 'mapped_status' };
    }

    // AC3: Null/empty trigger status — discard all tasks with warn
    if (!ai_trigger_status || ai_trigger_status.trim() === '') {
      this.logger.warn(
        `[${correlationId}] CS1-6: project ${project_id} integration has no ai_trigger_status configured — all tasks skipped. PM must set the trigger status in project settings`,
        { taskId, provider, project_id, source },
      );
      this.metrics.incrementCounter('pm_tasks_dropped_no_trigger_total', { provider, project_id });
      return { allowed: false, reason: 'trigger_not_configured' };
    }

    // AC4/AC5: Case-insensitive, trimmed comparison
    const normalizedTaskStatus = taskStatus.trim().toLowerCase();
    const normalizedTrigger = ai_trigger_status.trim().toLowerCase();

    if (normalizedTaskStatus !== normalizedTrigger) {
      this.logger.debug(
        `[${correlationId}] CS1-6: task ${taskId} status '${taskStatus}' — not at trigger '${ai_trigger_status}', skipping`,
        { taskId, taskStatus, ai_trigger_status, provider, source },
      );
      if (source === 'polling') {
        this.metrics.incrementCounter('pm_polling_tasks_skipped_total', { provider, project_id });
      }
      return { allowed: false, reason: 'status_mismatch' };
    }

    // Gate passed
    return { allowed: true, reason: 'allowed' };
  }
}
