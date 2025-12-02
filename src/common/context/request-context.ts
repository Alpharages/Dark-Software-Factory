import { v4 as uuidv4 } from 'uuid';
import { RequestContextData, asyncLocalStorage } from './async-local-storage';
import { LOGGER_CONSTANTS } from '../logger/logger.constants';

export function createRequestContext(
  headers: Record<string, string | string[] | undefined>,
): RequestContextData {
  const requestIdHeader = headers[LOGGER_CONSTANTS.REQUEST_ID_HEADER];
  const requestId = Array.isArray(requestIdHeader)
    ? requestIdHeader[0]
    : requestIdHeader || uuidv4();

  const correlationIdHeader = headers[LOGGER_CONSTANTS.CORRELATION_ID_HEADER];
  const correlationId = Array.isArray(correlationIdHeader)
    ? correlationIdHeader[0]
    : correlationIdHeader || uuidv4();

  return { requestId, correlationId, startTime: Date.now() };
}

export function setUserContext(userId: string, userRole?: string): void {
  const store = asyncLocalStorage.getStore();
  if (store) {
    store.userId = userId;
    store.userRole = userRole;
  }
}
