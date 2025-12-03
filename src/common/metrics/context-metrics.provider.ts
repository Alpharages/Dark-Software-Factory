import { Provider } from '@nestjs/common';
import {
  makeHistogramProvider,
  makeCounterProvider,
} from '@willsoto/nestjs-prometheus';
import { METRICS_CONSTANTS } from './metrics.constants';

/**
 * Context Extraction Metrics - Story 2.12
 * FR3: PM can attach context documents
 * FR59: System extracts project context
 */

export const CONTEXT_METRICS = {
  EXTRACTION_DURATION: `${METRICS_CONSTANTS.PREFIX}context_extraction_duration_seconds`,
  UPLOADS_TOTAL: `${METRICS_CONSTANTS.PREFIX}context_uploads_total`,
  EXTRACTION_ERRORS: `${METRICS_CONSTANTS.PREFIX}context_extraction_errors_total`,
  DOCUMENTS_SIZE: `${METRICS_CONSTANTS.PREFIX}context_documents_size_bytes`,
  CACHE_HITS: `${METRICS_CONSTANTS.PREFIX}context_cache_hits_total`,
} as const;

export const contextMetricsProviders: Provider[] = [
  makeHistogramProvider({
    name: CONTEXT_METRICS.EXTRACTION_DURATION,
    help: 'Duration of context extraction in seconds',
    labelNames: ['format', 'status'],
    buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
  }),
  makeCounterProvider({
    name: CONTEXT_METRICS.UPLOADS_TOTAL,
    help: 'Total context document uploads',
    labelNames: ['status', 'format'],
  }),
  makeCounterProvider({
    name: CONTEXT_METRICS.EXTRACTION_ERRORS,
    help: 'Total context extraction errors',
    labelNames: ['format', 'reason'],
  }),
  makeHistogramProvider({
    name: CONTEXT_METRICS.DOCUMENTS_SIZE,
    help: 'Size of uploaded context documents in bytes',
    labelNames: ['format'],
    buckets: [10240, 102400, 512000, 1048576, 5242880, 10485760], // 10KB to 10MB
  }),
  makeCounterProvider({
    name: CONTEXT_METRICS.CACHE_HITS,
    help: 'Context cache hit count',
    labelNames: ['hit'],
  }),
];
