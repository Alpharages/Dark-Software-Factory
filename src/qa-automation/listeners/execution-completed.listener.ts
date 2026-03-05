import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventBusService } from '../../common/event-bus.service';
import { ExecutionCompletedEvent } from '../../execution/events/execution-completed.event';
import { QaCheckPublisher } from '../qa-check.publisher';
import { ICodeFile } from '../interfaces';

@Injectable()
export class ExecutionCompletedListener implements OnModuleInit {
  private readonly logger = new Logger(ExecutionCompletedListener.name);

  constructor(
    private readonly qaCheckPublisher: QaCheckPublisher,
    private readonly eventBus: EventBusService,
  ) {
    this.logger.log('ExecutionCompletedListener instantiated');
  }

  onModuleInit() {
    this.logger.log('ExecutionCompletedListener initializing subscription');
    this.eventBus.on('execution.completed', (event: ExecutionCompletedEvent) =>
      this.handleExecutionCompleted(event),
    );
  }

  async handleExecutionCompleted(event: ExecutionCompletedEvent) {
    this.logger.log(`Handling execution.completed event for execution ${event.executionId}`);
    this.logger.debug(
      `Received execution.completed payload: ${JSON.stringify({
        executionId: event.executionId,
        ticketId: event.ticketId,
        filesChangedCount: event.filesChanged?.length,
        aiProvider: event.aiProvider,
      })}`,
    );

    try {
      // Build lightweight file list — only include path and language.
      // The full diff is sent once as a shared field, NOT duplicated per file.
      const codeFiles: ICodeFile[] = event.filesChanged.map((filePath: string) => ({
        path: filePath,
        content: '', // Per-file content is not available at this stage
        language: this.detectLanguage(filePath),
      }));

      await this.qaCheckPublisher.publishQaCheck(
        event.executionId,
        event.ticketId,
        event.projectId,
        codeFiles,
        event.aiProvider,
        event.correlationId,
      );

      this.logger.log(
        `Successfully published QA check triggered by event for ${event.executionId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to publish QA check for execution ${event.executionId}: ${
          (error as Error).message
        }`,
      );
    }
  }

  private detectLanguage(
    filePath: string,
  ): 'typescript' | 'javascript' | 'python' | 'go' | 'unknown' {
    const ext = filePath.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'ts':
      case 'tsx':
        return 'typescript';
      case 'js':
      case 'jsx':
        return 'javascript';
      case 'py':
        return 'python';
      case 'go':
        return 'go';
      default:
        return 'unknown';
    }
  }
}
