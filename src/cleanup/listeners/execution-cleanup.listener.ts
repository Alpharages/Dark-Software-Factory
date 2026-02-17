import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventBusService } from '../../common/event-bus.service';
import { ExecutionCompletedEvent } from '../../execution/events/execution-completed.event';
import { CleanupService } from '../cleanup.service';

@Injectable()
export class ExecutionCleanupListener implements OnModuleInit {
  private readonly logger = new Logger(ExecutionCleanupListener.name);

  constructor(
    private readonly cleanupService: CleanupService,
    private readonly eventBus: EventBusService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit() {
    this.eventBus.on('execution.completed', (event: ExecutionCompletedEvent) =>
      this.handleExecutionCompleted(event),
    );
  }

  async handleExecutionCompleted(event: ExecutionCompletedEvent) {
    this.logger.log(`Triggering cleanup for completed execution ${event.executionId}`);

    // CRITICAL FIX: When execution completes, we still need the workspace for QA + GitHub push.
    // The workspace must survive until the code is pushed to GitHub.
    // - Container can be cleaned up immediately (it's no longer needed)
    // - Workspace must be preserved so GitHubCommitOrchestrator can commit & push
    //
    // The workspace will be cleaned up AFTER GitHub push by GitHubPushTriggerConsumer,
    // or by the periodic stale workspace cleanup if the push never happens.
    try {
      await this.cleanupService.cleanupAfterExecution(event.executionId, {
        preserveWorkspace: true, // Preserve workspace for QA + GitHub push
        forceContainerRemove: false,
      });
      this.logger.log(
        `Container cleaned up for execution ${event.executionId}, workspace preserved for GitHub push`,
      );
    } catch (error) {
      this.logger.error(
        `Cleanup failed for execution ${event.executionId}: ${(error as Error).message}`,
      );
    }
  }
}
