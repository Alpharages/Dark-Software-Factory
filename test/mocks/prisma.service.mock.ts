/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable } from '@nestjs/common';

@Injectable()
export class PrismaService {
  public $connect = jest.fn().mockResolvedValue(undefined);
  public $disconnect = jest.fn().mockResolvedValue(undefined);
  public $on = jest.fn();
  public $use = jest.fn();
  public $transaction = jest.fn((cb) => cb(this));
  public $queryRaw = jest.fn().mockResolvedValue([]);
  public $executeRaw = jest.fn().mockResolvedValue(0);

  constructor() {
    return new Proxy(this, {
      get: (target: any, prop: string) => {
        if (prop in target) {
          return target[prop];
        }

        // Return a mock object for any model property (all lowercase or starts with lowercase)
        if (
          typeof prop === 'string' &&
          prop.length > 0 &&
          prop[0] === prop[0].toLowerCase() &&
          !prop.startsWith('$')
        ) {
          const mockModel = {
            findUnique: jest.fn().mockResolvedValue(null),
            findFirst: jest.fn().mockResolvedValue(null),
            findMany: jest.fn().mockResolvedValue([]),
            create: jest.fn().mockResolvedValue({}),
            update: jest.fn().mockResolvedValue({}),
            delete: jest.fn().mockResolvedValue({}),
            count: jest.fn().mockResolvedValue(0),
            groupBy: jest.fn().mockResolvedValue([]),
            aggregate: jest.fn().mockResolvedValue({}),
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
            deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
            upsert: jest.fn().mockResolvedValue({}),
          };
          target[prop] = mockModel;
          return mockModel;
        }
        return undefined;
      },
    }) as any;
  }
}
