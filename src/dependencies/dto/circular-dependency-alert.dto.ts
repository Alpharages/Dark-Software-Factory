/**
 * DTO for circular dependency alert messages
 */

/**
 * Structure for PM alert about circular dependencies
 */
export class CircularDependencyAlertDto {
  /** Markdown-formatted alert message */
  alertMessage: string;

  /** Cycle path visualization (e.g., "Task A → Task B → Task A") */
  cyclePath: string;

  /** List of affected ticket IDs */
  affectedTicketIds: string[];

  /** Timestamp of detection */
  detectionTime: Date;

  constructor(
    alertMessage: string,
    cyclePath: string,
    affectedTicketIds: string[],
    detectionTime: Date = new Date(),
  ) {
    this.alertMessage = alertMessage;
    this.cyclePath = cyclePath;
    this.affectedTicketIds = affectedTicketIds;
    this.detectionTime = detectionTime;
  }
}
