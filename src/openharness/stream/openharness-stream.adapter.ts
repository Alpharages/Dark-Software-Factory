import { Injectable, Logger } from '@nestjs/common';
import { ExecutionRepository } from '@/execution/execution.repository';
import {
  ActivityCategory,
  ContainerActivityPayload,
  detectLogLevel,
  LogLevel,
} from '@/execution/gateways/execution.gateway';
import { RealtimeService } from '@/realtime/realtime.service';
import {
  OpenHarnessAssistantCompleteEvent,
  OpenHarnessAssistantDeltaEvent,
  OpenHarnessStreamEvent,
  OpenHarnessToolStartedEvent,
} from './openharness-event.types';

interface BufferedLogEntry {
  message: string;
  timer: NodeJS.Timeout;
  ticketId: string;
}

@Injectable()
export class OpenHarnessStreamAdapter {
  private readonly logger = new Logger(OpenHarnessStreamAdapter.name);
  private readonly projectIdCache = new Map<string, string>();
  private readonly logStreamBuffer = new Map<string, BufferedLogEntry>();
  private readonly logStreamThrottleMs = parseInt(process.env.LOG_STREAM_THROTTLE_MS || '100', 10);

  constructor(
    private readonly realtimeService: RealtimeService,
    private readonly executionRepository: ExecutionRepository,
  ) {}

  async handleEvent(
    executionId: string,
    ticketId: string,
    event: OpenHarnessStreamEvent,
  ): Promise<void> {
    try {
      switch (event.type) {
        case 'tool_started':
          await this.handleToolStarted(executionId, ticketId, event as OpenHarnessToolStartedEvent);
          return;
        case 'assistant_delta':
          await this.handleAssistantDelta(
            executionId,
            ticketId,
            event as OpenHarnessAssistantDeltaEvent,
          );
          return;
        case 'assistant_complete':
          await this.handleAssistantComplete(
            executionId,
            ticketId,
            event as OpenHarnessAssistantCompleteEvent,
          );
          return;
        default:
          this.logger.warn(`Skipping unknown OpenHarness stream event: ${event.type}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to adapt OpenHarness stream event ${event.type}: ${message}`);
    }
  }

  private async handleToolStarted(
    executionId: string,
    ticketId: string,
    event: OpenHarnessToolStartedEvent,
  ): Promise<void> {
    const projectId = await this.resolveProjectId(executionId);
    const toolName = this.extractToolName(event);
    const payload: ContainerActivityPayload = {
      executionId,
      ticketId,
      timestamp: new Date().toISOString(),
      activity: `Tool started: ${toolName}`,
      detail: this.extractToolDetail(event),
      rawContent: this.stringifyEvent(event),
      category: 'AI_CODING' satisfies ActivityCategory,
      icon: 'tool',
      projectId,
    };

    this.emitActivity(projectId, payload);
  }

  private async handleAssistantDelta(
    executionId: string,
    ticketId: string,
    event: OpenHarnessAssistantDeltaEvent,
  ): Promise<void> {
    await this.resolveProjectId(executionId);
    const text = this.extractDeltaText(event);
    if (!text) return;
    this.bufferAndEmitLog(executionId, ticketId, text, 'stdout');
  }

  private async handleAssistantComplete(
    executionId: string,
    ticketId: string,
    event: OpenHarnessAssistantCompleteEvent,
  ): Promise<void> {
    await this.resolveProjectId(executionId);

    // Flush any buffered assistant text so it lands before the final marker.
    this.flushLogBuffer(executionId, 'stdout');

    // Emit the assistant's final message as a terminal log marker only. The
    // run-terminal `execution.completed` event is owned solely by the runner's
    // ExecutionTracker.completeExecution() (the single source of the persisted
    // payload); emitting it here too would double-fire it to the dashboard.
    const summary = this.extractSummary(event);
    if (summary) {
      this.emitLog(executionId, ticketId, summary, 'stdout', LogLevel.INFO);
    }

    // This execution emits no further live events; release its cached state.
    this.releaseExecution(executionId);
  }

  private async resolveProjectId(executionId: string): Promise<string | null> {
    const cached = this.projectIdCache.get(executionId);
    if (cached) return cached;

    try {
      const execution = await this.executionRepository.findById(executionId);
      const projectId = execution?.ticket?.project_id ?? null;
      // Only cache a resolved, non-null projectId. Caching null would pin the
      // run to role-room fallback even after the project becomes resolvable.
      if (projectId) {
        this.projectIdCache.set(executionId, projectId);
      }
      return projectId;
    } catch {
      return null;
    }
  }

  /** Release all per-execution state once a run can emit no further events. */
  private releaseExecution(executionId: string): void {
    this.projectIdCache.delete(executionId);
    for (const source of ['stdout', 'stderr'] as const) {
      const bufferKey = `${executionId}:${source}`;
      const entry = this.logStreamBuffer.get(bufferKey);
      if (entry) {
        clearTimeout(entry.timer);
        this.logStreamBuffer.delete(bufferKey);
      }
    }
  }

  private bufferAndEmitLog(
    executionId: string,
    ticketId: string,
    message: string,
    source: 'stdout' | 'stderr',
  ): void {
    const bufferKey = `${executionId}:${source}`;
    const existing = this.logStreamBuffer.get(bufferKey);

    if (existing) {
      clearTimeout(existing.timer);
      existing.message += `\n${message}`;
      existing.ticketId = ticketId;
    }

    const timer = setTimeout(() => {
      this.flushLogBuffer(executionId, source);
    }, this.logStreamThrottleMs);

    if (existing) {
      existing.timer = timer;
      return;
    }

    this.logStreamBuffer.set(bufferKey, { message, timer, ticketId });
  }

  private flushLogBuffer(executionId: string, source: 'stdout' | 'stderr'): void {
    const bufferKey = `${executionId}:${source}`;
    const entry = this.logStreamBuffer.get(bufferKey);
    if (!entry) return;

    clearTimeout(entry.timer);
    const level = detectLogLevel(entry.message);
    this.emitLog(executionId, entry.ticketId, entry.message, source, level);
    this.logStreamBuffer.delete(bufferKey);
  }

  private emitActivity(projectId: string | null, payload: ContainerActivityPayload): void {
    if (projectId) {
      this.realtimeService.emitToProject(projectId, 'execution-activity', payload);
      return;
    }

    this.realtimeService.emitToRole('ADMIN', 'execution-activity', payload);
    this.realtimeService.emitToRole('MANAGER', 'execution-activity', payload);
  }

  private emitLog(
    executionId: string,
    ticketId: string,
    message: string,
    source: 'stdout' | 'stderr',
    level: LogLevel,
  ): void {
    const projectId = this.projectIdCache.get(executionId) ?? null;
    const payload = {
      executionId,
      ticketId,
      timestamp: new Date().toISOString(),
      level,
      message,
      source,
      projectId,
    };

    if (projectId) {
      this.realtimeService.emitToProject(projectId, 'execution.log', payload);
      return;
    }

    this.realtimeService.emitToRole('ADMIN', 'execution.log', payload);
    this.realtimeService.emitToRole('DEVELOPER', 'execution.log', payload);
  }

  private extractToolName(event: OpenHarnessToolStartedEvent): string {
    if (typeof event.tool_name === 'string' && event.tool_name.trim()) {
      return event.tool_name.trim();
    }
    if (typeof event.name === 'string' && event.name.trim()) {
      return event.name.trim();
    }
    return 'unknown';
  }

  private extractToolDetail(event: OpenHarnessToolStartedEvent): string | undefined {
    if (event.input === undefined) return undefined;
    return this.stringifyEvent(event.input);
  }

  private extractDeltaText(event: OpenHarnessAssistantDeltaEvent): string {
    if (typeof event.delta === 'string' && event.delta.length > 0) {
      return event.delta;
    }
    if (typeof event.text === 'string' && event.text.length > 0) {
      return event.text;
    }
    if (typeof event.content === 'string' && event.content.length > 0) {
      return event.content;
    }
    if (typeof event.message === 'string' && event.message.length > 0) {
      return event.message;
    }
    return '';
  }

  private extractSummary(event: OpenHarnessAssistantCompleteEvent): string {
    return typeof event.summary === 'string' && event.summary.trim() ? event.summary.trim() : '';
  }

  private stringifyEvent(value: unknown): string {
    try {
      return JSON.stringify(value);
    } catch {
      return '[unserializable]';
    }
  }
}
