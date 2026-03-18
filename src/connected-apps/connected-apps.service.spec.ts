import { Test, TestingModule } from '@nestjs/testing';
import { ConnectedAppsService } from './connected-apps.service';
import { PrismaService } from '@/database/prisma.service';
import { EncryptionService } from '@/common/encryption/encryption.service';
import { AppProvider } from '@/prisma/enums';
import { NotFoundException, ForbiddenException } from '@nestjs/common';

describe('ConnectedAppsService', () => {
  let service: ConnectedAppsService;
  let prisma: jest.Mocked<typeof mockPrismaService>;
  let encryption: jest.Mocked<typeof mockEncryptionService>;

  const mockEncryptionService = {
    encrypt: jest.fn().mockImplementation((val: string) => `enc_${val}`),
    decrypt: jest.fn().mockImplementation((val: string) => val.replace('enc_', '')),
  };

  const mockPrismaService = {
    connectedApp: {
      create: jest.fn(),
      upsert: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
  };

  const baseApp = {
    id: 'app-1',
    user_id: 'user-1',
    provider: AppProvider.CLICKUP,
    workspace_id: 'ws-1',
    workspace_name: 'My Workspace',
    access_token: 'enc_token-123',
    refresh_token: null,
    token_expiry: null,
    metadata: null,
    created_at: new Date('2026-03-17T00:00:00.000Z'),
    updated_at: new Date('2026-03-17T00:00:00.000Z'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConnectedAppsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: EncryptionService, useValue: mockEncryptionService },
      ],
    }).compile();

    service = module.get<ConnectedAppsService>(ConnectedAppsService);
    prisma = module.get(PrismaService);
    encryption = module.get(EncryptionService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should encrypt tokens before insert; plaintext never stored', async () => {
      mockPrismaService.connectedApp.create.mockResolvedValue(baseApp);

      const result = await service.create('user-1', AppProvider.CLICKUP, {
        workspace_id: 'ws-1',
        workspace_name: 'My Workspace',
        access_token: 'token-123',
        refresh_token: 'refresh-123',
      });

      expect(encryption.encrypt).toHaveBeenCalledWith('token-123');
      expect(encryption.encrypt).toHaveBeenCalledWith('refresh-123');
      expect(prisma.connectedApp.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          access_token: 'enc_token-123',
          refresh_token: 'enc_refresh-123',
        }),
      });
      // Plaintext never in result — DTO excludes token fields entirely
      expect(result).not.toHaveProperty('access_token');
      expect(result).not.toHaveProperty('refresh_token');
      expect(result.id).toBe('app-1');
    });
  });

  describe('upsert', () => {
    it('should create new record with encrypted tokens (create path)', async () => {
      mockPrismaService.connectedApp.upsert.mockResolvedValue(baseApp);

      const result = await service.upsert('user-1', AppProvider.CLICKUP, 'ws-1', {
        workspace_id: 'ws-1',
        workspace_name: 'My Workspace',
        access_token: 'new-token',
      });

      expect(prisma.connectedApp.upsert).toHaveBeenCalledWith({
        where: {
          user_id_provider_workspace_id: {
            user_id: 'user-1',
            provider: AppProvider.CLICKUP,
            workspace_id: 'ws-1',
          },
        },
        update: expect.objectContaining({ workspace_name: 'My Workspace' }),
        create: expect.objectContaining({
          user_id: 'user-1',
          provider: AppProvider.CLICKUP,
          workspace_id: 'ws-1',
          workspace_name: 'My Workspace',
        }),
      });
      expect(result.workspace_name).toBe('My Workspace');
    });

    it('should update existing record with re-encrypted tokens (update path)', async () => {
      const updatedApp = {
        ...baseApp,
        workspace_name: 'Renamed Workspace',
        access_token: 'enc_updated-token',
      };
      mockPrismaService.connectedApp.upsert.mockResolvedValue(updatedApp);

      const result = await service.upsert('user-1', AppProvider.CLICKUP, 'ws-1', {
        workspace_id: 'ws-1',
        workspace_name: 'Renamed Workspace',
        access_token: 'updated-token',
      });

      expect(encryption.encrypt).toHaveBeenCalledWith('updated-token');
      expect(prisma.connectedApp.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ access_token: 'enc_updated-token' }),
        }),
      );
      expect(result.workspace_name).toBe('Renamed Workspace');
    });
  });

  describe('findByUser', () => {
    it('should return all connected apps for a user without token fields', async () => {
      mockPrismaService.connectedApp.findMany.mockResolvedValue([
        { ...baseApp, id: '1', provider: AppProvider.CLICKUP },
        { ...baseApp, id: '2', provider: AppProvider.JIRA },
      ]);

      const result = await service.findByUser('user-1');

      expect(prisma.connectedApp.findMany).toHaveBeenCalledWith({
        where: { user_id: 'user-1' },
        orderBy: { created_at: 'desc' },
      });
      expect(result).toHaveLength(2);
      expect(result[0].provider).toBe('clickup');
      expect(result[1].provider).toBe('jira');
      expect(result[0]).not.toHaveProperty('access_token');
    });
  });

  describe('findByUserAndProvider', () => {
    it('should filter results by provider correctly', async () => {
      mockPrismaService.connectedApp.findMany.mockResolvedValue([baseApp]);

      const result = await service.findByUserAndProvider('user-1', AppProvider.CLICKUP);

      expect(prisma.connectedApp.findMany).toHaveBeenCalledWith({
        where: { user_id: 'user-1', provider: AppProvider.CLICKUP },
        orderBy: { created_at: 'desc' },
      });
      expect(result).toHaveLength(1);
      expect(result[0].provider).toBe('clickup');
    });
  });

  describe('findById', () => {
    it('should return null if not found', async () => {
      mockPrismaService.connectedApp.findUnique.mockResolvedValue(null);

      const result = await service.findById('nonexistent');

      expect(result).toBeNull();
    });

    it('should return dto if found', async () => {
      mockPrismaService.connectedApp.findUnique.mockResolvedValue(baseApp);

      const result = await service.findById('app-1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('app-1');
    });
  });

  describe('getDecrypted', () => {
    it('should return decrypted tokens for own record', async () => {
      mockPrismaService.connectedApp.findUnique.mockResolvedValue({
        ...baseApp,
        access_token: 'enc_secret-token',
        refresh_token: 'enc_secret-refresh',
      });

      const result = await service.getDecrypted('app-1', 'user-1');

      expect(result.access_token).toBe('secret-token');
      expect(result.refresh_token).toBe('secret-refresh');
    });

    it('should throw NotFoundException if not found', async () => {
      mockPrismaService.connectedApp.findUnique.mockResolvedValue(null);

      await expect(service.getDecrypted('nonexistent', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException if userId mismatch', async () => {
      mockPrismaService.connectedApp.findUnique.mockResolvedValue({
        ...baseApp,
        user_id: 'other-user',
      });

      await expect(service.getDecrypted('app-1', 'user-1')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('delete', () => {
    it('should delete own record', async () => {
      mockPrismaService.connectedApp.findUnique.mockResolvedValue(baseApp);

      await service.delete('app-1', 'user-1');

      expect(prisma.connectedApp.delete).toHaveBeenCalledWith({ where: { id: 'app-1' } });
    });

    it('should throw ForbiddenException if not owner', async () => {
      mockPrismaService.connectedApp.findUnique.mockResolvedValue({
        ...baseApp,
        user_id: 'other-user',
      });

      await expect(service.delete('app-1', 'user-1')).rejects.toThrow(ForbiddenException);
      expect(prisma.connectedApp.delete).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException if missing', async () => {
      mockPrismaService.connectedApp.findUnique.mockResolvedValue(null);

      await expect(service.delete('nonexistent', 'user-1')).rejects.toThrow(NotFoundException);
      expect(prisma.connectedApp.delete).not.toHaveBeenCalled();
    });
  });
});
