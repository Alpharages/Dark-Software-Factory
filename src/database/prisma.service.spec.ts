import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from './prisma.service';

describe('PrismaService', () => {
  let service: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PrismaService],
    }).compile();

    service = module.get<PrismaService>(PrismaService);
  });

  afterEach(async () => {
    await service.$disconnect();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should extend PrismaClient', () => {
    expect(service).toBeInstanceOf(PrismaService);
    expect(service.$connect).toBeDefined();
    expect(service.$disconnect).toBeDefined();
  });

  it('should have cleanDatabase method for testing', () => {
    expect(service.cleanDatabase).toBeDefined();
    expect(typeof service.cleanDatabase).toBe('function');
  });

  it('should throw error when cleaning database in production', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    await expect(service.cleanDatabase()).rejects.toThrow('Cannot clean database in production!');

    process.env.NODE_ENV = originalEnv;
  });
});
