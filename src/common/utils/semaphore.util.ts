/**
 * Simple Semaphore implementation for concurrency control
 * Used to limit the number of concurrent operations (e.g., Docker container executions)
 */
export class Semaphore {
  private tasks: (() => void)[] = [];
  private count: number;
  private readonly max: number;

  constructor(max: number) {
    this.max = max;
    this.count = max;
  }

  /**
   * Acquire a permit. If no permits are available, returns a Promise that holds
   * until a permit is released.
   */
  async acquire(): Promise<void> {
    if (this.count > 0) {
      this.count--;
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.tasks.push(resolve);
    });
  }

  /**
   * Release a permit. If there are waiting tasks, the next one is immediately executed.
   * Otherwise, the permit count is incremented.
   */
  release(): void {
    if (this.tasks.length > 0) {
      const next = this.tasks.shift();
      if (next) {
        next();
      }
    } else {
      if (this.count < this.max) {
        this.count++;
      }
    }
  }

  /**
   * Run a function exclusively within the semaphore
   */
  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /**
   * Get the number of available permits
   */
  getAvailablePermits(): number {
    return this.count;
  }

  /**
   * Get the number of waiting tasks
   */
  getQueueLength(): number {
    return this.tasks.length;
  }
}
