import { OhAssistantEvent, OhEvent, OhResultEvent } from './types/oh-event.types';

export class OpenHarnessStreamParser {
  private filesChanged: Set<string> = new Set();
  private toolsUsed: Set<string> = new Set();
  private progress: unknown = null;
  private result: OhResultEvent | null = null;
  private tokensUsed = 0;

  parseLine(line: string): OhEvent | null {
    try {
      const parsed = JSON.parse(line) as OhEvent;
      // OhEventType is a narrow union; the live OpenHarness 0.1.9 stream also
      // carries `assistant_complete` / `tool_started`. Widen to a string for the
      // dispatch so we can recognize both vocabularies.
      const type: string = parsed.type;

      if (type === 'progress') {
        this.progress = parsed;
        return parsed;
      }

      if (type === 'result') {
        // Claude Code (`claude -p … --output-format stream-json`) emits its
        // terminal event as `result` too, but with a different shape:
        // `{ subtype, is_error, result }` — no `status`/`summary`/`files_changed`.
        // Normalize it to the OhResultEvent contract the runner consumes. The
        // native oh `result` event (which carries `status`) falls through
        // unchanged via the else branch.
        const ev = parsed as OhResultEvent & {
          is_error?: boolean;
          result?: string;
          subtype?: string;
        };
        if (
          ev.status === undefined &&
          (ev.is_error !== undefined || typeof ev.result === 'string')
        ) {
          this.result = {
            type: 'result',
            status: ev.is_error ? 'FAILED' : 'COMPLETED',
            summary: typeof ev.result === 'string' ? ev.result : undefined,
            error_message: ev.is_error
              ? typeof ev.result === 'string'
                ? ev.result
                : (ev.subtype ?? 'Claude Code run failed')
              : undefined,
            error_context: ev.is_error ? JSON.stringify(ev) : undefined,
            files_changed: ev.files_changed,
          };
        } else {
          this.result = ev;
        }
        this.collectFilesChanged(this.result.files_changed);
        // Claude Code's terminal `result` event carries a `usage` block
        // ({input_tokens, output_tokens, cache_*}). Capture the total so the
        // account selector can meter token budgets, not just request counts.
        this.tokensUsed = this.extractTokens(parsed);
        return parsed;
      }

      // OpenHarness 0.1.9 (`oh -p … --output-format stream-json`) signals
      // completion with an `assistant_complete` event, NOT a `result` event.
      // Treat it as the terminal result: it carries the final summary and, for
      // skill runs, files_changed. A later real `result` event (if a future oh
      // version emits one) still overrides this via the branch above.
      if (type === 'assistant_complete') {
        const ev = parsed as { summary?: string; text?: string; files_changed?: unknown[] };
        const summary = ev.summary ?? ev.text;
        if (!summary && !Array.isArray(ev.files_changed)) return parsed;
        this.result = {
          type: 'result',
          status: 'COMPLETED',
          summary,
          files_changed: ev.files_changed,
        };
        this.collectFilesChanged(ev.files_changed);
        return parsed;
      }

      if (type === 'error') {
        const ev = parsed as { message?: string; error?: string; details?: unknown };
        this.result = {
          type: 'result',
          status: 'FAILED',
          error_message: ev.message ?? ev.error ?? 'OpenHarness emitted an error event',
          error_context: JSON.stringify(ev),
        };
        return parsed;
      }

      // Tool usage: legacy `assistant.message.content[tool_use]` OR the 0.1.9
      // `tool_started` event.
      if (type === 'tool_started') {
        const ev = parsed as { tool_name?: string; name?: string };
        const name = ev.tool_name ?? ev.name;
        if (name) this.toolsUsed.add(name);
        return parsed;
      }

      if (type === 'assistant') {
        const assistant = parsed as OhAssistantEvent;
        if (assistant.message?.content) {
          for (const block of assistant.message.content) {
            if (block.type === 'tool_use' && block.name) {
              this.toolsUsed.add(block.name);
            }
          }
        }
        return parsed;
      }

      return parsed;
    } catch {
      // Non-JSON / unrecognized lines are skipped silently
      return null;
    }
  }

  /** Accumulate file paths from a `files_changed` array of strings or `{ file }` objects. */
  private collectFilesChanged(files?: unknown[]): void {
    if (!Array.isArray(files)) return;
    for (const f of files) {
      if (typeof f === 'string') this.filesChanged.add(f);
      else if (f && typeof f === 'object' && 'file' in f) {
        const fileObj = f as Record<string, unknown>;
        if (typeof fileObj.file === 'string') this.filesChanged.add(fileObj.file);
      }
    }
  }

  getFilesChanged(): string[] {
    return Array.from(this.filesChanged);
  }

  getToolsUsed(): string[] {
    return Array.from(this.toolsUsed);
  }

  getProgress(): unknown {
    return this.progress;
  }

  getResult(): OhResultEvent | null {
    return this.result;
  }

  /** Total tokens consumed by the run (0 when the stream carries no usage). */
  getTokensUsed(): number {
    return this.tokensUsed;
  }

  /** Sum every *_tokens field in a `usage` block — covers input/output/cache. */
  private extractTokens(raw: unknown): number {
    if (!raw || typeof raw !== 'object') return 0;
    const usage = (raw as { usage?: unknown }).usage;
    if (!usage || typeof usage !== 'object') return 0;
    let total = 0;
    for (const [key, value] of Object.entries(usage)) {
      if (key.endsWith('tokens') && typeof value === 'number' && Number.isFinite(value)) {
        total += value;
      }
    }
    return total;
  }
}
