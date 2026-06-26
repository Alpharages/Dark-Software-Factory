export type OpenHarnessLiveEventType =
  | 'tool_started'
  | 'assistant_delta'
  | 'assistant_complete'
  // Claude Code (`claude -p --output-format stream-json`) vocabulary. These are
  // the live events emitted by the first-party runtime (OPENHARNESS_RUNTIME=claude)
  // and are normalized to dashboard activities by the stream adapter.
  | 'system'
  | 'assistant'
  | 'user';

/** A single content block inside a Claude `assistant`/`user` message. */
export interface ClaudeContentBlock {
  type: string;
  text?: string;
  // tool_use
  id?: string;
  name?: string;
  input?: unknown;
  // tool_result
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
  [key: string]: unknown;
}

/** Claude `system` event (e.g. `{ type:'system', subtype:'init', model, tools }`). */
export interface ClaudeSystemEvent {
  type: 'system';
  subtype?: string;
  model?: string;
  tools?: unknown;
  cwd?: string;
  [key: string]: unknown;
}

/** Claude `assistant` event — carries text and/or tool_use content blocks. */
export interface ClaudeAssistantEvent {
  type: 'assistant';
  message?: { role?: string; content?: ClaudeContentBlock[] };
  [key: string]: unknown;
}

/** Claude `user` event — carries tool_result content blocks. */
export interface ClaudeUserEvent {
  type: 'user';
  message?: { role?: string; content?: ClaudeContentBlock[] };
  [key: string]: unknown;
}

export interface OpenHarnessToolStartedEvent {
  type: 'tool_started';
  tool_name?: string;
  name?: string;
  input?: unknown;
  [key: string]: unknown;
}

export interface OpenHarnessAssistantDeltaEvent {
  type: 'assistant_delta';
  delta?: string;
  text?: string;
  content?: string;
  message?: string;
  [key: string]: unknown;
}

export interface OpenHarnessAssistantCompleteEvent {
  type: 'assistant_complete';
  summary?: string;
  files_changed?: unknown[];
  duration_seconds?: number;
  [key: string]: unknown;
}

export interface OpenHarnessUnknownEvent {
  type: string;
  [key: string]: unknown;
}

export type OpenHarnessLiveEvent =
  | OpenHarnessToolStartedEvent
  | OpenHarnessAssistantDeltaEvent
  | OpenHarnessAssistantCompleteEvent
  | ClaudeSystemEvent
  | ClaudeAssistantEvent
  | ClaudeUserEvent;

export type OpenHarnessStreamEvent = OpenHarnessLiveEvent | OpenHarnessUnknownEvent;

const LIVE_EVENT_TYPES: ReadonlySet<string> = new Set<string>([
  // OpenHarness 0.1.9 vocabulary
  'tool_started',
  'assistant_delta',
  'assistant_complete',
  // Claude Code vocabulary
  'system',
  'assistant',
  'user',
]);

export function isOpenHarnessLiveEvent(
  event: OpenHarnessStreamEvent,
): event is OpenHarnessLiveEvent {
  return LIVE_EVENT_TYPES.has(event.type);
}
