import { format } from 'winston';
import { redactSensitiveData } from './sensitive-data.redactor';

const { combine, timestamp, errors, json, printf } = format;

export const jsonFormatter = (serviceName: string, redactFields: string[] = []) =>
  combine(
    timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
    errors({ stack: true }),
    format((info) => {
      const {
        level,
        message,
        timestamp: ts,
        requestId = 'system',
        correlationId = 'system',
        context = {},
        stack,
        ...rest
      } = info;

      const logEntry: Record<string, unknown> = {
        level,
        timestamp: ts,
        requestId,
        correlationId,
        service: serviceName,
        message: typeof message === 'string' ? message : JSON.stringify(message),
        context: redactSensitiveData({ ...(context as object), ...(rest as object) }, redactFields),
      };

      if (level === 'error' && stack) {
        logEntry.error = { stack };
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return logEntry as any;
    })(),
    json(),
  );

export const prettyFormatter = (serviceName: string, redactFields: string[] = []) =>
  combine(
    timestamp({ format: 'HH:mm:ss.SSS' }),
    errors({ stack: true }),
    format.colorize({ all: true }),
    printf(({ level, message, timestamp: ts, requestId, correlationId, stack, ...rest }) => {
      const reqId = requestId ? `[${String(requestId).slice(0, 8)}]` : '';
      const corrId = correlationId ? `[${String(correlationId).slice(0, 8)}]` : '';
      const contextStr =
        Object.keys(rest).length > 0
          ? `\n  ${JSON.stringify(redactSensitiveData(rest, redactFields), null, 2).replace(/\n/g, '\n  ')}`
          : '';
      const stackStr = stack ? `\n${stack}` : '';
      return `${ts} ${level} ${reqId}${corrId} ${message}${contextStr}${stackStr}`;
    }),
  );
