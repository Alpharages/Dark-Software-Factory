/**
 * Circuit Breaker Unit Tests
 * Story 2.6: AI Provider Integration - Cursor CLI Headless Mode
 */

import { CircuitBreaker, CircuitState } from './circuit-breaker';

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker('test', {
      failureThreshold: 3,
      resetTimeoutMs: 1000,
      successThreshold: 2,
    });
  });

  describe('initial state', () => {
    it('should start in CLOSED state', () => {
      expect(breaker.getState()).toBe(CircuitState.CLOSED);
      expect(breaker.canExecute()).toBe(true);
    });

    it('should have zero failure count initially', () => {
      const status = breaker.getStatus();
      expect(status.failureCount).toBe(0);
      expect(status.lastSuccessTime).toBeNull();
      expect(status.lastFailureTime).toBeNull();
    });
  });

  describe('recordSuccess', () => {
    it('should reset failure count on success in CLOSED state', () => {
      breaker.recordFailure();
      breaker.recordFailure();
      expect(breaker.getStatus().failureCount).toBe(2);

      breaker.recordSuccess();

      expect(breaker.getStatus().failureCount).toBe(0);
      expect(breaker.getState()).toBe(CircuitState.CLOSED);
    });

    it('should update lastSuccessTime', () => {
      const before = new Date();
      breaker.recordSuccess();
      const after = new Date();

      const status = breaker.getStatus();
      expect(status.lastSuccessTime).not.toBeNull();
      expect(status.lastSuccessTime!.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(status.lastSuccessTime!.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe('recordFailure', () => {
    it('should increment failure count', () => {
      breaker.recordFailure();
      expect(breaker.getStatus().failureCount).toBe(1);

      breaker.recordFailure();
      expect(breaker.getStatus().failureCount).toBe(2);
    });

    it('should open circuit after threshold failures', () => {
      breaker.recordFailure();
      breaker.recordFailure();
      expect(breaker.getState()).toBe(CircuitState.CLOSED);

      breaker.recordFailure(); // Third failure
      expect(breaker.getState()).toBe(CircuitState.OPEN);
      expect(breaker.canExecute()).toBe(false);
    });

    it('should update lastFailureTime', () => {
      const before = new Date();
      breaker.recordFailure();
      const after = new Date();

      const status = breaker.getStatus();
      expect(status.lastFailureTime).not.toBeNull();
      expect(status.lastFailureTime!.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(status.lastFailureTime!.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe('state transitions', () => {
    it('should reset failure count on success before threshold', () => {
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordSuccess();

      expect(breaker.getState()).toBe(CircuitState.CLOSED);

      // Would need 3 more failures to open
      breaker.recordFailure();
      breaker.recordFailure();
      expect(breaker.getState()).toBe(CircuitState.CLOSED);
    });

    it('should transition to HALF_OPEN after timeout', async () => {
      // Open the circuit
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordFailure();
      expect(breaker.getState()).toBe(CircuitState.OPEN);

      // Wait for reset timeout
      await new Promise((resolve) => setTimeout(resolve, 1100));

      expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);
      expect(breaker.canExecute()).toBe(true);
    });

    it('should close circuit after success threshold in HALF_OPEN', async () => {
      // Open the circuit
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordFailure();

      // Wait for HALF_OPEN
      await new Promise((resolve) => setTimeout(resolve, 1100));
      expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);

      // Success threshold is 2
      breaker.recordSuccess();
      expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);

      breaker.recordSuccess();
      expect(breaker.getState()).toBe(CircuitState.CLOSED);
    });

    it('should re-open circuit on failure in HALF_OPEN', async () => {
      // Open the circuit
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordFailure();

      // Wait for HALF_OPEN
      await new Promise((resolve) => setTimeout(resolve, 1100));
      expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);

      // Single failure in HALF_OPEN should open again
      breaker.recordFailure();
      expect(breaker.getState()).toBe(CircuitState.OPEN);
    });
  });

  describe('reset', () => {
    it('should manually reset circuit to CLOSED', () => {
      // Open the circuit
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordFailure();
      expect(breaker.getState()).toBe(CircuitState.OPEN);

      breaker.reset();

      expect(breaker.getState()).toBe(CircuitState.CLOSED);
      expect(breaker.getStatus().failureCount).toBe(0);
      expect(breaker.canExecute()).toBe(true);
    });
  });

  describe('canExecute', () => {
    it('should return true in CLOSED state', () => {
      expect(breaker.canExecute()).toBe(true);
    });

    it('should return false in OPEN state', () => {
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordFailure();

      expect(breaker.canExecute()).toBe(false);
    });

    it('should return true in HALF_OPEN state', async () => {
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordFailure();

      await new Promise((resolve) => setTimeout(resolve, 1100));

      expect(breaker.canExecute()).toBe(true);
    });
  });

  describe('getStatus', () => {
    it('should return complete status object', () => {
      breaker.recordSuccess();
      breaker.recordFailure();

      const status = breaker.getStatus();

      expect(status).toEqual({
        state: CircuitState.CLOSED,
        failureCount: 1,
        lastSuccessTime: expect.any(Date),
        lastFailureTime: expect.any(Date),
      });
    });
  });
});
