import { OhAssistantEvent, OhEvent, OhResultEvent } from './types/oh-event.types';

export class OpenHarnessStreamParser {
  private filesChanged: Set<string> = new Set();
  private toolsUsed: Set<string> = new Set();
  private progress: unknown = null;
  private result: OhResultEvent | null = null;

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
        this.result = parsed as OhResultEvent;
        this.collectFilesChanged(this.result.files_changed);
        return parsed;
      }

      // OpenHarness 0.1.9 (`oh -p … --output-format stream-json`) signals
      // completion with an `assistant_complete` event, NOT a `result` event.
      // Treat it as the terminal result: it carries the final summary and, for
      // skill runs, files_changed. A later real `result` event (if a future oh
      // version emits one) still overrides this via the branch above.
      if (type === 'assistant_complete') {
        const ev = parsed as { summary?: string; text?: string; files_changed?: unknown[] };
        this.result = {
          type: 'result',
          status: 'COMPLETED',
          summary: ev.summary ?? ev.text,
          files_changed: ev.files_changed,
        };
        this.collectFilesChanged(ev.files_changed);
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
}
