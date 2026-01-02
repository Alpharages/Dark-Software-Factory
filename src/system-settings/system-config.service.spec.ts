import { Test, TestingModule } from '@nestjs/testing';
import { SystemConfigService } from './system-config.service';
import { PrismaService } from '@/database/prisma.service';
import { ConfigService } from '@nestjs/config';

describe('SystemConfigService', () => {
  let service: SystemConfigService;
  let prisma: any;
  let config: any;

  beforeEach(async () => {
    prisma = {
      systemConfig: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        upsert: jest.fn(),
        delete: jest.fn(),
      },
    };
    config = {
      get: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SystemConfigService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    service = module.get<SystemConfigService>(SystemConfigService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('get', () => {
    it('should return from DB if exists', async () => {
      prisma.systemConfig.findUnique.mockResolvedValue({ key: 'foo', value: 'bar' });
      expect(await service.get('foo')).toBe('bar');
    });

    it('should fallback to env if not in DB', async () => {
      prisma.systemConfig.findUnique.mockResolvedValue(null);
      config.get.mockReturnValue('env-val');
      expect(await service.get('foo')).toBe('env-val');
      expect(config.get).toHaveBeenCalledWith('FOO');
    });

    it('should handle dot notation in env fallback', async () => {
      prisma.systemConfig.findUnique.mockResolvedValue(null);
      config.get.mockReturnValue('env-val');
      await service.get('foo.bar');
      expect(config.get).toHaveBeenCalledWith('FOO_BAR');
    });

    it('should return default if neither in DB nor Env', async () => {
      prisma.systemConfig.findUnique.mockResolvedValue(null);
      config.get.mockReturnValue(undefined);
      expect(await service.get('foo', 'def')).toBe('def');
    });
  });

  describe('set', () => {
    it('should upsert config', async () => {
      const expected = { key: 'k', value: 'v' };
      prisma.systemConfig.upsert.mockResolvedValue(expected);
      expect(await service.set('k', 'v', 'desc', false, 'user-id')).toEqual(expected);
      expect(prisma.systemConfig.upsert).toHaveBeenCalled();
    });
  });
});
