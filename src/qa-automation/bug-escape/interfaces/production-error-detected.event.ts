export interface ProductionErrorDetectedEvent {
  production_error_id: string;
  application: string;
  error_fingerprint: string; // Used to match with ticket context
  ticket_id?: string; // May be null if auto-detection fails
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  occurred_at: Date | string; // Date object or ISO string
}
