import type { FileLockQueueStatus } from '@/prisma/client';

describe('Prisma schema (File Locks)', () => {
  it('should expose FileLockQueueStatus enum', () => {
    const status: FileLockQueueStatus = 'WAITING';
    expect(status).toBe('WAITING');
  });
});
