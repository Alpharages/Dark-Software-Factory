import DailyRotateFile from 'winston-daily-rotate-file';
import { LOGGER_CONSTANTS } from '../logger.constants';
import { jsonFormatter } from '../formatters';

export function createCombinedFileTransport(
  serviceName: string,
  logDir: string,
  redactFields: string[] = [],
): DailyRotateFile {
  return new DailyRotateFile({
    dirname: logDir,
    filename: LOGGER_CONSTANTS.COMBINED_LOG,
    datePattern: LOGGER_CONSTANTS.DATE_PATTERN,
    maxSize: LOGGER_CONSTANTS.MAX_FILE_SIZE,
    maxFiles: `${LOGGER_CONSTANTS.RETENTION_DAYS}d`,
    format: jsonFormatter(serviceName, redactFields),
    zippedArchive: true,
  });
}

export function createErrorFileTransport(
  serviceName: string,
  logDir: string,
  redactFields: string[] = [],
): DailyRotateFile {
  return new DailyRotateFile({
    dirname: logDir,
    filename: LOGGER_CONSTANTS.ERROR_LOG,
    datePattern: LOGGER_CONSTANTS.DATE_PATTERN,
    maxSize: LOGGER_CONSTANTS.MAX_FILE_SIZE,
    maxFiles: `${LOGGER_CONSTANTS.RETENTION_DAYS}d`,
    level: 'error',
    format: jsonFormatter(serviceName, redactFields),
    zippedArchive: true,
  });
}
