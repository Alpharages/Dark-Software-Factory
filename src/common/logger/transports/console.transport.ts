import { transports } from 'winston';
import { jsonFormatter, prettyFormatter } from '../formatters';

export function createConsoleTransport(
  serviceName: string,
  isProduction: boolean,
  redactFields: string[] = [],
) {
  return new transports.Console({
    format: isProduction
      ? jsonFormatter(serviceName, redactFields)
      : prettyFormatter(serviceName, redactFields),
  });
}
