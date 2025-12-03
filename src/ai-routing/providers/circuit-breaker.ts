/**
 * Circuit Breaker
 * Story 2.6: AI Provider Integration - Cursor CLI Headless Mode
 *
 * Implements the circuit breaker pattern for resilience.
 * Prevents cascading failures by failing fast when provider is unhealthy.
 *
 * Architecture Reference: NFR-R4 (Reliability)
 */

import { Logger } from '@nestjs/common';

/**
 * Circuit Breaker State
 */
export enum CircuitState {
  /** Normal operation - requests allowed */
  CLOSED = 'CLOSED',

  /** Failures exceeded threshold - requests blocked */
  OPEN = 'OPEN',

  /** Testing recovery - limited requests allowed */
  HALF_OPEN = 'HALF_OPEN',
}

/**
 * Circuit Breaker Configuration
 */
export interface CircuitBreakerConfig {
  /** Number of failures to open circuit */
  failureThreshold: number;

  /** Time to wait before testing recovery (ms) */
  resetTimeoutMs: number;

  /** Number of successes to close circuit from half-open */
  successThreshold: number;
}

/**
 * Default circuit breaker configuration
 */
const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 30_000, // 30 seconds
  successThreshold: 3,
};

/**
 * Circuit Breaker
 *
 * Implements the circuit breaker pattern for resilience.
 * Prevents cascading failures by failing fast when provider is unhealthy.
 */
export class CircuitBreaker {
  private readonly logger = new Logger(CircuitBreaker.name);

  private state: CircuitState = CircuitState.CLOSED;
  private failureCount: number = 0;
  private successCount: number = 0;
  private lastFailureTime: Date | null = null;
  private lastSuccessTime: Date | null = null;
  private nextAttemptTime: Date | null = null;

  constructor(
    private readonly name: string,
    private readonly config: CircuitBreakerConfig = DEFAULT_CONFIG,
  ) {}

  /**
   * Check if request is allowed
   */
  canExecute(): boolean {
    this.updateState();

    switch (this.state) {
      case CircuitState.CLOSED:
        return true;

      case CircuitState.OPEN:
        return false;

      case CircuitState.HALF_OPEN:
        // Allow limited requests in half-open state
        return true;

      default:
        return false;
    }
  }

  /**
   * Record successful execution
   */
  recordSuccess(): void {
    this.lastSuccessTime = new Date();

    switch (this.state) {
      case CircuitState.CLOSED:
        this.failureCount = 0;
        break;

      case CircuitState.HALF_OPEN:
        this.successCount++;
        if (this.successCount >= this.config.successThreshold) {
          this.close();
        }
        break;
    }
  }

  /**
   * Record failed execution
   */
  recordFailure(): void {
    this.lastFailureTime = new Date();
    this.failureCount++;

    switch (this.state) {
      case CircuitState.CLOSED:
        if (this.failureCount >= this.config.failureThreshold) {
          this.open();
        }
        break;

      case CircuitState.HALF_OPEN:
        this.open();
        break;
    }
  }

  /**
   * Get current state
   */
  getState(): CircuitState {
    this.updateState();
    return this.state;
  }

  /**
   * Get circuit breaker status
   */
  getStatus(): {
    state: CircuitState;
    failureCount: number;
    lastSuccessTime: Date | null;
    lastFailureTime: Date | null;
  } {
    this.updateState();
    return {
      state: this.state,
      failureCount: this.failureCount,
      lastSuccessTime: this.lastSuccessTime,
      lastFailureTime: this.lastFailureTime,
    };
  }

  /**
   * Force circuit to close (manual recovery)
   */
  reset(): void {
    this.close();
    this.logger.log(`[${this.name}] Circuit manually reset`);
  }

  /**
   * Update state based on time
   */
  private updateState(): void {
    if (this.state === CircuitState.OPEN && this.nextAttemptTime) {
      if (new Date() >= this.nextAttemptTime) {
        this.halfOpen();
      }
    }
  }

  /**
   * Transition to OPEN state
   */
  private open(): void {
    this.state = CircuitState.OPEN;
    this.nextAttemptTime = new Date(Date.now() + this.config.resetTimeoutMs);
    this.successCount = 0;

    this.logger.warn(
      `[${this.name}] Circuit OPENED after ${this.failureCount} failures. ` +
        `Will retry at ${this.nextAttemptTime.toISOString()}`,
    );
  }

  /**
   * Transition to HALF_OPEN state
   */
  private halfOpen(): void {
    this.state = CircuitState.HALF_OPEN;
    this.successCount = 0;

    this.logger.log(`[${this.name}] Circuit HALF_OPEN - testing recovery`);
  }

  /**
   * Transition to CLOSED state
   */
  private close(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.nextAttemptTime = null;

    this.logger.log(`[${this.name}] Circuit CLOSED - normal operation resumed`);
  }
}
