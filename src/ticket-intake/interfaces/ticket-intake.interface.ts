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

/**
 * Story 2.11: PM-Facing Quality Scoring Types
 * FR4: PMs can view ticket quality score before submitting
 */

/** Enhanced category score with suggestions for PM API */
export interface ICategoryScore {
  category: string;
  score: number;
  maxPoints: number;
  percentage: number;
  suggestions: string[];
  details: string;
}

/** Enhanced breakdown with category details for PM API */
export interface IQualityScoreBreakdownEnhanced {
  titleClarity: ICategoryScore;
  descriptionCompleteness: ICategoryScore;
  acceptanceCriteria: ICategoryScore;
  contextDocuments: ICategoryScore;
  taskComplexity: ICategoryScore;
  prerequisites: ICategoryScore;
}

/** Quality grade type */
export type QualityGrade = 'excellent' | 'good' | 'fair' | 'poor';

/** Enhanced quality score response for PM API */
export interface IQualityScoreEnhanced {
  totalScore: number;
  grade: QualityGrade;
  gradeEmoji: string;
  gradeMessage: string;
  breakdown: IQualityScoreBreakdownEnhanced;
  topSuggestions: string[];
  meetsMinimumThreshold: boolean;
  scoredAt: string;
}

/** Input for PM-facing quality scoring API */
export interface IQualityScoreInput {
  title: string;
  description: string;
  acceptanceCriteria: string;
  contextDocuments?: string[];
  tags?: string[];
  prerequisites?: string[];
  projectContext?: string;
}
