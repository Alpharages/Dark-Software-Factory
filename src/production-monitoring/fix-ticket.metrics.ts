import { Injectable } from '@nestjs/common';
import { Counter, Registry } from 'prom-client';

@Injectable()
export class FixTicketMetrics {
  private readonly fixTicketsCreatedTotal: Counter;
  private readonly fixTicketsSkippedTotal: Counter;
  private readonly fixTicketsFailedTotal: Counter;

  constructor(private readonly registry: Registry) {
    this.fixTicketsCreatedTotal = new Counter({
      name: 'fix_tickets_created_total',
      help: 'Total number of ClickUp fix tickets created for production errors',
      labelNames: ['severity', 'application'],
      registers: [registry],
    });

    this.fixTicketsSkippedTotal = new Counter({
      name: 'fix_tickets_skipped_total',
      help: 'Total number of fix tickets skipped (below threshold or duplicate)',
      labelNames: ['reason', 'severity'],
      registers: [registry],
    });

    this.fixTicketsFailedTotal = new Counter({
      name: 'fix_tickets_failed_total',
      help: 'Total number of fix ticket creation failures',
      labelNames: ['error_type', 'severity'],
      registers: [registry],
    });
  }

  recordTicketCreated(severity: string, application: string): void {
    this.fixTicketsCreatedTotal.inc({ severity, application });
  }

  recordTicketSkipped(reason: 'threshold' | 'duplicate', severity: string): void {
    this.fixTicketsSkippedTotal.inc({ reason, severity });
  }

  recordTicketFailed(errorType: string, severity: string): void {
    this.fixTicketsFailedTotal.inc({ error_type: errorType, severity });
  }
}
