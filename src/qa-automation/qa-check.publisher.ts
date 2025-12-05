/**
 * QA Check Publisher
 * Story 3.7: RabbitMQ QA Queue Processing
 *
 * Publishes QA check requests to qa-check-queue after AI execution completes
 */

import { Injectable } from '@nestjs/common';
import { RabbitMQPublisherService } from '../rabbitmq/rabbitmq-publisher.service';
import { QUEUE_NAMES } from '../rabbitmq/rabbitmq.config';
import { LoggerService } from '../common/logger/logger.service';
import { IQaQueueMessage, ICodeFile } from './interfaces';

@Injectable()
export class QaCheckPublisher {
  constructor(
    private readonly publisher: RabbitMQPublisherService,
    private readonly logger: LoggerService,
  ) {}

  /**
   * Publish QA check message to qa-check-queue
   * AC#1: Publishes message with execution_id, ticket_id, code_files, correlation_id, project_id, ai_provider
   */
  async publishQaCheck(
    executionId: string,
    ticketId: string,
    projectId: string,
    codeFiles: ICodeFile[],
    aiProvider: string,
    correlationId: string,
  ): Promise<boolean> {
    const message: IQaQueueMessage = {
      executionId,
      ticketId,
      projectId,
      codeFiles,
      aiProvider,
      correlationId,
      completedAt: new Date().toISOString(),
    };

    this.logger.log(`Publishing QA check for execution ${executionId}`, {
      context: 'QaCheckPublisher',
      correlationId,
      ticketId,
      fileCount: codeFiles.length,
    });

    return this.publisher.publishWithRetry(QUEUE_NAMES.QA_CHECK, message, 3, correlationId);
  }
}
