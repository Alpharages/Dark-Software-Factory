import { Injectable, Logger } from '@nestjs/common';
import { ExecutionRepository } from '@/execution/execution.repository';
import { ExecutionActivityRepository } from '@/execution/repositories/execution-activity.repository';
import { ExecutionTrackerService } from '@/execution/execution-tracker.service';
import {
  ActivityCategory,
  ContainerActivityPayload,
  detectLogLevel,
  LogLevel,
} from '@/execution/gateways/execution.gateway';
import { RealtimeService } from '@/realtime/realtime.service';
import {
  ClaudeAssistantEvent,
  ClaudeSystemEvent,
  ClaudeUserEvent,
  OpenHarnessAssistantCompleteEvent,
  OpenHarnessAssistantDeltaEvent,
  OpenHarnessStreamEvent,
  OpenHarnessToolStartedEvent,
} from './openharness-event.types';

/** Max chars of free-form text/tool output persisted + shown in the timeline. */
const MAX_DETAIL_CHARS = 160;
const MAX_RAW_CHARS = 4000;

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
  // Last progress percent emitted per execution. Agentic runs carry no true
  // progress signal, so we synthesize a monotonic value that decelerates toward
  // a cap (PROGRESS_CAP) — visible movement without claiming false precision.
  // The runner sets 100% on terminal success.
  private readonly progressPercent = new Map<string, number>();
  private static readonly PROGRESS_CAP = 90;
  private static readonly PROGRESS_START = 5;

  constructor(
    private readonly realtimeService: RealtimeService,
    private readonly executionRepository: ExecutionRepository,
    private readonly activityRepository: ExecutionActivityRepository,
    private readonly executionTracker: ExecutionTrackerService,
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
        // ── Claude Code (`claude -p`) vocabulary ──────────────────────────
        case 'system':
          await this.handleClaudeSystem(executionId, ticketId, event as ClaudeSystemEvent);
          return;
        case 'assistant':
          await this.handleClaudeAssistant(executionId, ticketId, event as ClaudeAssistantEvent);
          return;
        case 'user':
          await this.handleClaudeUser(executionId, ticketId, event as ClaudeUserEvent);
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

  /**
   * Claude `system` event — typically the `init` marker carrying the model and
   * available tools. Emitted once at the start of a leg as a SETUP activity so
   * the dashboard shows the run has begun.
   */
  private async handleClaudeSystem(
    executionId: string,
    ticketId: string,
    event: ClaudeSystemEvent,
  ): Promise<void> {
    if (event.subtype && event.subtype !== 'init') return; // only surface init
    const projectId = await this.resolveProjectId(executionId);
    const detail = typeof event.model === 'string' ? `Model: ${event.model}` : undefined;
    this.emitActivity(projectId, {
      executionId,
      ticketId,
      timestamp: new Date().toISOString(),
      activity: 'AI session started',
      detail,
      rawContent: this.truncate(this.stringifyEvent(event), MAX_RAW_CHARS),
      category: 'SETUP',
      icon: 'settings',
      projectId,
    });
  }

  /**
   * Claude `assistant` event — one assistant turn. Each content block becomes an
   * activity: `text` → AI_THINKING (what the agent is reasoning/saying),
   * `tool_use` → a category derived from the tool (AI_CODING / FILE_OP / etc.).
   */
  private async handleClaudeAssistant(
    executionId: string,
    ticketId: string,
    event: ClaudeAssistantEvent,
  ): Promise<void> {
    const blocks = event.message?.content;
    if (!Array.isArray(blocks) || blocks.length === 0) return;
    const projectId = await this.resolveProjectId(executionId);

    for (const block of blocks) {
      if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
        const text = block.text.trim();
        this.emitActivity(projectId, {
          executionId,
          ticketId,
          timestamp: new Date().toISOString(),
          activity: this.firstLine(text),
          detail: undefined,
          rawContent: this.truncate(text, MAX_RAW_CHARS),
          category: 'AI_THINKING',
          icon: 'brain',
          projectId,
        });
      } else if (block.type === 'tool_use' && block.name) {
        const { category, icon } = this.classifyTool(block.name);
        this.emitActivity(projectId, {
          executionId,
          ticketId,
          timestamp: new Date().toISOString(),
          activity: `Running ${block.name}`,
          detail: this.toolInputSummary(block.input),
          rawContent: this.truncate(this.stringifyEvent(block.input), MAX_RAW_CHARS),
          category,
          icon,
          projectId,
        });
      }
    }
  }

  /**
   * Claude `user` event — tool results fed back to the model. Surfaced as a
   * concise activity (errors flagged), with the full output available on expand.
   */
  private async handleClaudeUser(
    executionId: string,
    ticketId: string,
    event: ClaudeUserEvent,
  ): Promise<void> {
    const blocks = event.message?.content;
    if (!Array.isArray(blocks) || blocks.length === 0) return;
    const projectId = await this.resolveProjectId(executionId);

    for (const block of blocks) {
      if (block.type !== 'tool_result') continue;
      const isError = block.is_error === true;
      const content = this.stringifyContent(block.content);
      this.emitActivity(projectId, {
        executionId,
        ticketId,
        timestamp: new Date().toISOString(),
        activity: isError ? 'Tool error' : 'Tool result',
        detail: content ? this.truncate(content, MAX_DETAIL_CHARS) : undefined,
        rawContent: content ? this.truncate(content, MAX_RAW_CHARS) : undefined,
        category: isError ? 'ERROR' : 'SYSTEM',
        icon: isError ? 'alert-triangle' : 'terminal',
        projectId,
      });
    }
  }

  /** Map a Claude tool name to a dashboard activity category + Lucide icon hint. */
  private classifyTool(toolName: string): { category: ActivityCategory; icon: string } {
    const name = toolName.toLowerCase();
    if (/(write|edit|multiedit|notebookedit)/.test(name)) {
      return { category: 'FILE_OP', icon: 'file-edit' };
    }
    if (/(read|glob|grep|ls)/.test(name)) {
      return { category: 'FILE_OP', icon: 'package-search' };
    }
    if (name.includes('bash')) {
      return { category: 'BUILD', icon: 'terminal' };
    }
    if (name.includes('task') || name.includes('agent')) {
      return { category: 'AI_THINKING', icon: 'brain' };
    }
    // MCP tools (bmad/lore/clickup/etc.) and anything else: generic AI coding.
    return { category: 'AI_CODING', icon: 'code' };
  }

  private firstLine(text: string): string {
    const line = text.split('\n').find((l) => l.trim()) ?? text;
    return this.truncate(line.trim(), MAX_DETAIL_CHARS);
  }

  private toolInputSummary(input: unknown): string | undefined {
    if (input === undefined || input === null) return undefined;
    if (typeof input === 'object') {
      const obj = input as Record<string, unknown>;
      // Prefer the most descriptive common fields.
      const key = obj.file_path ?? obj.path ?? obj.command ?? obj.pattern ?? obj.query;
      if (typeof key === 'string') return this.truncate(key, MAX_DETAIL_CHARS);
    }
    return this.truncate(this.stringifyEvent(input), MAX_DETAIL_CHARS);
  }

  private stringifyContent(content: unknown): string {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .map((c) =>
          c && typeof c === 'object' && 'text' in (c as Record<string, unknown>)
            ? String((c as Record<string, unknown>).text)
            : this.stringifyEvent(c),
        )
        .join('\n');
    }
    return this.stringifyEvent(content);
  }

  private truncate(value: string, max: number): string {
    if (value.length <= max) return value;
    return `${value.slice(0, max)}…`;
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
    this.progressPercent.delete(executionId);
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
    // Persist first (fire-and-forget) so the timeline survives a page reload and
    // is queryable via GET /executions/:id/logs. The persisted row reuses the
    // payload's exact ISO timestamp so the frontend can dedupe a live socket
    // event against the replayed-on-reload copy. A DB failure must never break
    // the live stream, so we only log it.
    this.activityRepository
      .save({
        executionId: payload.executionId,
        activity: payload.activity,
        detail: payload.detail ?? null,
        rawContent: payload.rawContent ?? null,
        category: payload.category,
        icon: payload.icon,
        suggestedPercent: payload.suggestedPercent ?? null,
        timestamp: new Date(payload.timestamp),
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Failed to persist execution activity for ${payload.executionId}: ${message}`,
        );
      });

    // Advance the progress bar + current-step label off the back of this activity.
    // Without this the dashboard sits at "STARTING EXECUTION 0%" for the whole run
    // because the agent stream carries no explicit progress field.
    this.bumpProgress(payload, projectId);

    if (projectId) {
      this.realtimeService.emitToProject(projectId, 'execution-activity', payload);
      return;
    }

    this.realtimeService.emitToRole('ADMIN', 'execution-activity', payload);
    this.realtimeService.emitToRole('MANAGER', 'execution-activity', payload);
  }

  /**
   * Translate the latest activity into a progress update (label + percent) and
   * push it through ExecutionTracker, which persists `{currentStep, percentComplete}`
   * (reload-safe) and emits `execution-progress-update` for the live card.
   *
   * Percent is a synthesized monotonic creep: an explicit `suggestedPercent` wins
   * if present, otherwise it decelerates toward PROGRESS_CAP so the bar always
   * moves forward but never reaches 100% until the runner marks the leg complete.
   */
  private bumpProgress(payload: ContainerActivityPayload, projectId: string | null): void {
    const prev =
      this.progressPercent.get(payload.executionId) ?? OpenHarnessStreamAdapter.PROGRESS_START;
    let next: number;
    if (typeof payload.suggestedPercent === 'number') {
      next = Math.max(prev, Math.min(100, payload.suggestedPercent));
    } else {
      const cap = OpenHarnessStreamAdapter.PROGRESS_CAP;
      const step = Math.max(1, Math.ceil((cap - prev) / 12));
      next = Math.min(cap, prev + step);
    }
    this.progressPercent.set(payload.executionId, next);

    void this.executionTracker
      .emitProgress(payload.executionId, payload.ticketId, projectId, payload.activity, next)
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Failed to emit progress for ${payload.executionId}: ${message}`);
      });
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
