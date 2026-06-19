export type OhEventType = 'progress' | 'result' | 'qa_attempt' | 'assistant';

export interface OhEventBase {
  type: OhEventType;
}

export interface OhProgressEvent extends OhEventBase {
  type: 'progress';
  step?: string;
  percent?: number;
  [key: string]: unknown;
}

export interface OhResultEvent extends OhEventBase {
  type: 'result';
  status?: string;
  summary?: string;
  error_message?: string;
  error_context?: string;
  files_changed?: unknown[];
  [key: string]: unknown;
}

export interface OhQaAttemptEvent extends OhEventBase {
  type: 'qa_attempt';
  [key: string]: unknown;
}

export interface OhAssistantEvent extends OhEventBase {
  type: 'assistant';
  message?: {
    content?: Array<{
      type?: string;
      text?: string;
      name?: string;
      input?: unknown;
    }>;
  };
  [key: string]: unknown;
}

export type OhEvent = OhProgressEvent | OhResultEvent | OhQaAttemptEvent | OhAssistantEvent;
