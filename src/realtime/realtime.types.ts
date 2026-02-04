/**
 * Realtime Event Type Definitions
 * Story 10-U-1: Socket.IO Real-Time Infrastructure
 *
 * Standard event types for real-time communication
 * Exported for use by consumer modules
 */

export interface ExecutionProgressEvent {
  executionId: string;
  ticketId: string;
  status: string;
  percentage?: number;
  message?: string;
}

export interface TicketUpdatedEvent {
  ticketId: string;
  status: string;
  updatedBy: string;
  timestamp: string;
}

export interface SystemAlertEvent {
  severity: 'info' | 'warning' | 'error' | 'critical';
  message: string;
  timestamp: string;
  source?: string;
}

/**
 * User context attached to WebSocket connections
 */
export interface WsUserContext {
  userId: string;
  roles: string[];
  email: string;
}
