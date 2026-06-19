export type OpenHarnessLiveEventType = 'tool_started' | 'assistant_delta' | 'assistant_complete';

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
  | OpenHarnessAssistantCompleteEvent;

export type OpenHarnessStreamEvent = OpenHarnessLiveEvent | OpenHarnessUnknownEvent;

export function isOpenHarnessLiveEvent(
  event: OpenHarnessStreamEvent,
): event is OpenHarnessLiveEvent {
  return (
    event.type === 'tool_started' ||
    event.type === 'assistant_delta' ||
    event.type === 'assistant_complete'
  );
}
