/**
 * Ticket Intake Interfaces
 * FR57: Parse ticket details | FR58: Validate ticket quality
 */

/** Raw task event from webhook queue (matches TaskEventDto from Story 2.1) */
export interface IRawTaskEvent {
  correlationId: string;
  webhookEventId: string;
  eventType: string;
  taskId: string;
  taskName: string;
  taskDescription: string | null;
  taskStatus: string;
  listId: string;
  listName: string;
  spaceId: string;
  projectId: string;
  projectName: string;
  taskUrl: string;
  tags: string[];
  customFields: Record<string, unknown>;
  creatorEmail: string;
  eventTimestamp: string;
  receivedAt: string;
}

export interface IParsedTicket {
  clickupTaskId: string;
  projectId: string;
  title: string;
  description: string;
  acceptanceCriteria: string;
  tags: string[];
  priority: string | null;
  creatorEmail: string;
  taskUrl: string;
  rawEvent: IRawTaskEvent;
}

export interface IValidationError {
  field: string;
  code: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface IQualityScoreBreakdown {
  titleClarity: number; // 0-15 pts
  descriptionCompleteness: number; // 0-25 pts
  acceptanceCriteria: number; // 0-30 pts
  contextDocuments: number; // 0-10 pts
  taskComplexity: number; // 0-10 pts
  prerequisites: number; // 0-10 pts
}

export interface IQualityScore {
  totalScore: number;
  breakdown: IQualityScoreBreakdown;
  grade: 'excellent' | 'good' | 'fair' | 'poor';
  suggestions: string[];
}

export interface ITicketProcessingResult {
  success: boolean;
  ticketId?: string;
  status: string;
  qualityScore?: number;
  errors?: string[];
}
