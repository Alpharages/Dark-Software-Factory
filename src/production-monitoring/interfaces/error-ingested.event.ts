/**
 * Error Ingested Event Interface
 * Story 9-U-4: Error Context Extraction & Linking
 */

export interface ErrorIngestedEvent {
  /** Production error ID */
  production_error_id: string;
  /** Application name */
  application: string;
  /** When the error occurred */
  occurred_at: Date;
  /** Optional correlation ID */
  correlation_id?: string;
  /** Optional execution ID */
  execution_id?: string;
}
