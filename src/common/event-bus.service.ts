import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Subject, Subscription, filter, map } from 'rxjs';

/**
 * Valid event types
 */
export type EventPayload = {
  'adr.reviewed': import('../architecture-review/events/adr-reviewed.event').AdrReviewedEvent;
  'adr.escalated': import('../architecture-review/events/adr-escalated.event').AdrEscalatedEvent;
  'execution.completed': import('../execution/events/execution-completed.event').ExecutionCompletedEvent;
};

@Injectable()
export class EventBusService implements OnModuleDestroy {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private subject$ = new Subject<{ key: keyof EventPayload; data: any }>();

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
      .subscribe(callback);
  }

  onModuleDestroy() {
    this.subject$.complete();
  }
}
