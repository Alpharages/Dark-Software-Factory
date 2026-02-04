import { AiCodeReviewRiskLevel, FindingSeverity } from '../dto/ai-code-review.dto';

export interface IAiFinding {
  severity: FindingSeverity;
  file: string;
  line?: number;
  description: string;
  suggestion?: string;
}

export interface IMissedIssue extends IAiFinding {
  category: string;
}

export interface ICodeSmell extends IAiFinding {
  type: string;
  refactoring_suggestion?: string;
}

export interface IComplexLogic {
  file: string;
  function: string;
  complexity_score: number;
  nesting_depth: number;
  lines_of_code: number;
  attention_required: boolean;
  rationale: string;
}

export interface ITestingGap {
  file: string;
  function?: string;
  gap_type: string;
  suggestion: string;
}

export interface ISecurityNote {
  severity: FindingSeverity;
  category: string;
  file: string;
  note: string;
}

export interface IAiFindingsCollection {
  missed_issues: IMissedIssue[];
  code_smells: ICodeSmell[];
  complex_logic: IComplexLogic[];
  testing_gaps: ITestingGap[];
  security_notes: ISecurityNote[];
}

export interface IAiCodeReviewResponse {
  queue_item_id: string;
  review_version: number;
  generated_at: string;
  ai_model: string;
  confidence_score: number;
  overall_assessment: AiCodeReviewRiskLevel;
  summary: string;
  findings: IAiFindingsCollection;
  generation_duration_ms: number;
  cost_usd?: number;
  review_time_estimate?: string; // Added per Story 8.2 AC#2
}
