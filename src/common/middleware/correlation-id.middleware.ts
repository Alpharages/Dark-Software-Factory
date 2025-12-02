import { Injectable, NestMiddleware } from '@nestjs/common';
import { FastifyRequest, FastifyReply } from 'fastify';
import { LOGGER_CONSTANTS } from '../logger/logger.constants';
import { createRequestContext, runInContext } from '../context';
import { LoggerService } from '../logger';

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  constructor(private readonly logger: LoggerService) {}

  use(req: FastifyRequest['raw'], res: FastifyReply['raw'], next: () => void): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const headers = (req as any).headers || {};
    const context = createRequestContext(headers);

    res.setHeader(LOGGER_CONSTANTS.REQUEST_ID_HEADER, context.requestId);
    res.setHeader(LOGGER_CONSTANTS.CORRELATION_ID_HEADER, context.correlationId);

    this.logger.debug('Request started', {
      requestId: context.requestId,
      correlationId: context.correlationId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      method: (req as any).method,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      url: (req as any).url,
    });

    runInContext(context, () => next());
  }
}
