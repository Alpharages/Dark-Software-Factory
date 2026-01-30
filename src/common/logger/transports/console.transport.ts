import { transports, format } from 'winston';
import { jsonFormatter, prettyFormatter } from '../formatters';

export function createConsoleTransport(
  serviceName: string,
  isProduction: boolean,
  redactFields: string[] = [],
) {
  // Filter out info level logs in development to reduce noise
  // distinct from just setting the validation logic
  const devFilter = format((info) => {
    if (!isProduction && info.level === 'info') {
      return false;
    }
    return info;
  });

  return new transports.Console({
    format: isProduction
      ? jsonFormatter(serviceName, redactFields)
      : format.combine(devFilter(), prettyFormatter(serviceName, redactFields)),
  });
}
