import { OhEvent, OhResultEvent } from './types/oh-event.types';

export class OpenHarnessStreamParser {
  private filesChanged: Set<string> = new Set();
  private toolsUsed: Set<string> = new Set();
  private progress: unknown = null;
  private result: OhResultEvent | null = null;

  parseLine(line: string): OhEvent | null {
    try {
      const parsed = JSON.parse(line) as OhEvent;

      if (parsed.type === 'progress') {
        this.progress = parsed;
        return parsed;
      }

      if (parsed.type === 'result') {
        this.result = parsed as OhResultEvent;
        if (this.result.files_changed && Array.isArray(this.result.files_changed)) {
          this.result.files_changed.forEach((f) => {
            // handle objects or strings
            if (typeof f === 'string') this.filesChanged.add(f);
            else if (f && typeof f === 'object' && 'file' in f) {
              const fileObj = f as Record<string, unknown>;
              if (typeof fileObj.file === 'string') {
                this.filesChanged.add(fileObj.file);
              }
            }
          });
        }
        return parsed;
      }

      if (parsed.type === 'assistant' && parsed.message?.content) {
        for (const block of parsed.message.content) {
          if (block.type === 'tool_use' && block.name) {
            this.toolsUsed.add(block.name);
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
