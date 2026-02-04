import { ErrorSeverity } from '../../prisma/enums';

export interface ErrorStoredEvent {
  production_error_id: string;
  application: string;
  severity: ErrorSeverity;
  occurred_at: Date;
  correlation_id?: string;
  execution_id?: string;
}
