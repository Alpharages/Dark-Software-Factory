import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Subject, Subscription, filter, map } from 'rxjs';

/**
 * Valid event types
 */
export type EventPayload = {
  'adr.reviewed': import('../architecture-review/events/adr-reviewed.event').AdrReviewedEvent;
  'adr.escalated': import('../architecture-review/events/adr-escalated.event').AdrEscalatedEvent;
  'execution.completed': import('../execution/events/execution-completed.event').ExecutionCompletedEvent;
  'execution.failed': import('../execution/events/execution-failed.event').ExecutionFailedEvent;
  'execution.cancelled': import('../execution/events/execution-cancelled.event').ExecutionCancelledEvent;
  'quality.anomaly.detected': import('../dashboards/events/quality-anomaly-detected.event').QualityAnomalyDetectedEvent;
};

@Injectable()
export class EventBusService implements OnModuleDestroy {
  private readonly id = Math.random().toString(36).substring(7);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private subject$ = new Subject<{ key: keyof EventPayload; data: any }>();

  constructor() {
    console.log(`[EventBusService] Initialized with ID: ${this.id}`);
  }

  /**
   * Emit an event
   */
  emit<K extends keyof EventPayload>(key: K, data: EventPayload[K]) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.subject$.next({ key, data: data as any });
  }

  /**
   * Subscribe to an event
   */
  on<K extends keyof EventPayload>(
    key: K,
    callback: (data: EventPayload[K]) => void,
  ): Subscription {
    return this.subject$
      .pipe(
        filter((event) => event.key === key),
        map((event) => event.data as EventPayload[K]),
      )
      .subscribe({
        next: (data) => {
          try {
            callback(data);
          } catch (error) {
            console.error(
              `[EventBusService] Error handling event ${key}:`,
              error instanceof Error ? error.message : error,
            );
          }
        },
        error: (err) => {
          console.error(
            `[EventBusService] Subscription error for event ${key}:`,
            err instanceof Error ? err.message : err,
          );
        },
      });
  }

  onModuleDestroy() {
    this.subject$.complete();
  }
}
