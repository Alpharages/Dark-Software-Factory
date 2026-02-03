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
  ) {}

  onModuleInit() {
    this.eventBus.on('execution.completed', (event: ExecutionCompletedEvent) =>
      this.handleExecutionCompleted(event),
    );
  }

  async handleExecutionCompleted(event: ExecutionCompletedEvent) {
    this.logger.log(`Handling execution.completed event for execution ${event.executionId}`);

    try {
      // Re-construct ICodeFile objects from event data
      // TODO: In actual implementation, content should be extracted per file
      const codeFiles: ICodeFile[] = event.filesChanged.map((filePath: string) => ({
        path: filePath,
        content: event.codeOutput,
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
