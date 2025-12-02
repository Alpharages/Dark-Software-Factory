import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { LoggerService } from '../logger';
import { getRequestId } from '../context';

/**
 * Global exception filter for consistent error logging and responses
 * Per architecture.md: "User-Facing Error Messages" + "Never expose stack traces"
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: LoggerService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException ? exception.getResponse() : 'Internal server error';

    const requestId = getRequestId();

    // Log the error with stack trace
    this.logger.error(
      `Exception caught: ${exception instanceof Error ? exception.message : 'Unknown error'}`,
      exception instanceof Error ? exception.stack : undefined,
      {
        statusCode: status,
        path: request.url,
        method: request.method,
        requestId,
      },
    );

    // Send user-friendly response
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const errorResponse: any = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      requestId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      message: typeof message === 'string' ? message : (message as any).message || message,
    };

    response.status(status).send(errorResponse);
  }
}
