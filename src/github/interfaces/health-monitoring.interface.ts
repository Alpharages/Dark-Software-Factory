/**
 * Baseline metrics captured before deployment for comparison
 */
export interface BaselineMetrics {
  error_rate: number; // Percentage (0-100)
  p95_latency: number; // Milliseconds
  captured_at: Date;
}

/**
 * Health check result after monitoring window
 */
export interface HealthCheckResult {
  deployment_id: string;
  status: 'healthy' | 'rollback_triggered';
  error_rate_delta: number; // Percentage points
  latency_delta: number; // Milliseconds
  rollback_reason?: 'error_rate' | 'latency' | 'both';
  metrics_snapshot: {
    current_error_rate: number;
    current_p95_latency: number;
    baseline_error_rate: number;
    baseline_p95_latency: number;
  };
}

/**
 * Rollback reason enum for type safety
 */
export type RollbackReason = 'error_rate' | 'latency' | 'both';
