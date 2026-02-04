/**
 * Error Created Event Interface
 * Story 9-U-5: Production Error Dashboard - AC#4
 *
 * Event payload for real-time error notifications via Socket.IO.
 */

import { ErrorSeverity } from '@/prisma/enums';

export interface ErrorCreatedEventPayload {
  id: string;
  application: string;
  error_type: string;
  severity: ErrorSeverity;
  occurred_at: string; // ISO format
  message: string;
}

export interface ErrorAcknowledgedEventPayload {
  id: string;
  acknowledged_by: string;
  acknowledged_at: string; // ISO format
}

export interface ErrorTicketCreatedEventPayload {
  id: string;
  ticket_url: string;
  created_at: string; // ISO format
}
