import { ExecutionConcurrencyGate } from './execution-concurrency.gate';

describe('ExecutionConcurrencyGate', () => {
  const makeGate = (opts: { global?: string; projectLimit?: number | null } = {}) => {
    const systemConfig = {
      get: jest.fn().mockResolvedValue(opts.global ?? '1'),
    };
    const prisma = {
      project: {
        findUnique: jest.fn().mockResolvedValue({
          execution_concurrency_limit: opts.projectLimit ?? null,
        }),
      },
    };
    return new ExecutionConcurrencyGate(prisma as never, systemConfig as never);
  };

  describe('limit resolution', () => {
    it('defaults to 1 when nothing is configured', async () => {
      await expect(makeGate().getGlobalLimit()).resolves.toBe(1);
    });

    it('uses the project override when set', async () => {
      await expect(makeGate({ global: '5', projectLimit: 2 }).resolveLimit('p1')).resolves.toBe(2);
    });

    it('inherits the global limit when the project override is null', async () => {
      await expect(makeGate({ global: '5', projectLimit: null }).resolveLimit('p1')).resolves.toBe(
        5,
      );
    });

    it('falls back rather than trusting a garbage or sub-1 configured value', async () => {
      await expect(makeGate({ global: 'not-a-number' }).getGlobalLimit()).resolves.toBe(1);
      await expect(makeGate({ global: '0' }).getGlobalLimit()).resolves.toBe(1);
      await expect(makeGate({ global: '-3' }).getGlobalLimit()).resolves.toBe(1);
    });
  });

  describe('slot accounting', () => {
    it('serialises acquires past the limit and lets the next in only on release', async () => {
      const gate = makeGate({ projectLimit: 1 });

      const releaseFirst = await gate.acquire('p1');
      expect(gate.activeCount('p1')).toBe(1);

      let secondEntered = false;
      const second = gate.acquire('p1').then((release) => {
        secondEntered = true;
        return release;
      });

      // Still blocked: the only slot is held.
      await Promise.resolve();
      expect(secondEntered).toBe(false);
      expect(gate.activeCount('p1')).toBe(1);

      releaseFirst();
      const releaseSecond = await second;
      expect(secondEntered).toBe(true);
      expect(gate.activeCount('p1')).toBe(1);

      releaseSecond();
      expect(gate.activeCount('p1')).toBe(0);
    });

    it('runs up to the limit concurrently', async () => {
      const gate = makeGate({ projectLimit: 2 });
      const a = await gate.acquire('p1');
      const b = await gate.acquire('p1');
      expect(gate.activeCount('p1')).toBe(2);
      a();
      b();
      expect(gate.activeCount('p1')).toBe(0);
    });

    it('does not let one project block another', async () => {
      const gate = makeGate({ projectLimit: 1 });
      await gate.acquire('p1');
      // Would hang if the cap were global rather than per-project.
      await gate.acquire('p2');
      expect(gate.activeCount('p1')).toBe(1);
      expect(gate.activeCount('p2')).toBe(1);
    });

    it('ignores a double release so it cannot free another caller slot', async () => {
      const gate = makeGate({ projectLimit: 2 });
      const release = await gate.acquire('p1');
      await gate.acquire('p1');
      expect(gate.activeCount('p1')).toBe(2);

      release();
      release();
      release();
      expect(gate.activeCount('p1')).toBe(1);
    });
  });
});
