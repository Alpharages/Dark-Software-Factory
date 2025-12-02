import { AsyncLocalStorage } from 'async_hooks';
import { PerformanceTimings } from '../logger/logger.interface';

export interface RequestContextData {
  requestId: string;
  correlationId: string;
  startTime: number;
  userId?: string;
  userRole?: string;
  timings?: PerformanceTimings;
}

export const asyncLocalStorage = new AsyncLocalStorage<RequestContextData>();

export function getRequestContext(): RequestContextData | undefined {
  return asyncLocalStorage.getStore();
}

export function getRequestId(): string | undefined {
  return asyncLocalStorage.getStore()?.requestId;
}

export function getCorrelationId(): string | undefined {
  return asyncLocalStorage.getStore()?.correlationId;
}

export function runInContext<T>(context: RequestContextData, fn: () => T): T {
  return asyncLocalStorage.run(context, fn);
}

export function addTiming(key: keyof PerformanceTimings, ms: number): void {
  const store = asyncLocalStorage.getStore();
  if (store) {
    store.timings = store.timings || {};
    store.timings[key] = ms;
  }
}
