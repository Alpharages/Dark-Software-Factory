import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error', 'warn'],
    });
  }

  async onModuleInit() {
    // Connect to database on module initialization
    await this.$connect();
    console.log('✅ Database connected');
  }

  async onModuleDestroy() {
    // Disconnect from database on module destruction
    await this.$disconnect();
    console.log('🔌 Database disconnected');
  }

  /**
   * Clean all tables (useful for testing)
   * WARNING: Use only in test environment!
   */
  async cleanDatabase() {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Cannot clean database in production!');
    }

    const models = Object.keys(this).filter((key) => !key.startsWith('_') && !key.startsWith('$'));

    for (const model of models) {
      try {
        // Access model using Reflect.get for type-safe property access
        const modelDelegate = Reflect.get(this, model) as { deleteMany?: () => Promise<unknown> };
        if (modelDelegate && typeof modelDelegate.deleteMany === 'function') {
          await modelDelegate.deleteMany();
        }
      } catch (error) {
        console.warn(`Could not clean ${model}:`, error);
      }
    }
  }
}
