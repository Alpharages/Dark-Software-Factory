import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventBusService } from '../../common/event-bus.service';
import { ExecutionCompletedEvent } from '../../execution/events/execution-completed.event';
import { CleanupService } from '../cleanup.service';

@Injectable()
export class ExecutionCleanupListener implements OnModuleInit {
  private readonly logger = new Logger(ExecutionCleanupListener.name);

  constructor(
    private readonly cleanupService: CleanupService,
    private readonly eventBus: EventBusService,
  ) {}

  onModuleInit() {
    this.eventBus.on('execution.completed', (event: ExecutionCompletedEvent) =>
      this.handleExecutionCompleted(event),
    );
  }

  async handleExecutionCompleted(event: ExecutionCompletedEvent) {
    this.logger.log(`Triggering cleanup for completed execution ${event.executionId}`);

    try {
      await this.cleanupService.cleanupAfterExecution(event.executionId, {
        preserveWorkspace: false, // Default for completion
        forceContainerRemove: false,
      });
    } catch (error) {
      this.logger.error(
        `Cleanup failed for execution ${event.executionId}: ${(error as Error).message}`,
      );
    }
  }
}
