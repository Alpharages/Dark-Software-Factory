/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test, TestingModule } from '@nestjs/testing';
import { ProjectIntegrationService } from './project-integration.service';
import { EncryptionService } from '@/common/encryption/encryption.service';
import { PrismaService } from '@/database/prisma.service';

describe('ProjectIntegrationService', () => {
  let service: ProjectIntegrationService;
  let encryptionService: EncryptionService;
  let prismaService: PrismaService;

  const mockEncryptionService = {
    encrypt: jest.fn().mockImplementation((val: string) => `encrypted_${val}`),
    decrypt: jest.fn().mockImplementation((val: string) => val.replace('encrypted_', '')),
  };

  const mockPrismaService = {
    projectIntegration: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectIntegrationService,
        { provide: EncryptionService, useValue: mockEncryptionService },
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<ProjectIntegrationService>(ProjectIntegrationService);
    encryptionService = module.get<EncryptionService>(EncryptionService);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createIntegration', () => {
    it('should encrypt tokens before saving and return plaintext tokens to caller', async () => {
      const inputDto = {
        project_id: 'proj-1',
        provider: 'CLICKUP' as any,
        workspace_id: 'ws-1',
        workspace_name: 'My Workspace',
        access_token: 'raw-access-token',
        refresh_token: 'raw-refresh-token',
        webhook_secret: 'raw-webhook-secret',
        polling_enabled: false,
        polling_interval_min: 15,
        webhook_enabled: false,
        provider_config: { team_id: 'team-1' },
      };

      mockPrismaService.projectIntegration.create.mockResolvedValue({
        id: 'pi-1',
        ...inputDto,
        access_token: 'encrypted_raw-access-token',
        refresh_token: 'encrypted_raw-refresh-token',
        webhook_secret: 'encrypted_raw-webhook-secret',
      });

      const result = await service.createIntegration(inputDto);

      expect(encryptionService.encrypt).toHaveBeenCalledTimes(3);
      expect(encryptionService.encrypt).toHaveBeenCalledWith('raw-access-token');
      expect(encryptionService.encrypt).toHaveBeenCalledWith('raw-refresh-token');
      expect(encryptionService.encrypt).toHaveBeenCalledWith('raw-webhook-secret');
      expect(prismaService.projectIntegration.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          access_token: 'encrypted_raw-access-token',
          refresh_token: 'encrypted_raw-refresh-token',
          webhook_secret: 'encrypted_raw-webhook-secret',
        }),
      });
      // Caller receives plaintext tokens — never raw ciphertext
      expect(result.access_token).toBe('raw-access-token');
      expect(result.refresh_token).toBe('raw-refresh-token');
      expect(result.webhook_secret).toBe('raw-webhook-secret');
    });

    it('should not call encrypt for absent token fields', async () => {
      const inputDto = {
        project_id: 'proj-1',
        provider: 'JIRA' as any,
        workspace_id: 'ws-2',
        workspace_name: 'Jira Workspace',
        polling_enabled: false,
        polling_interval_min: 15,
        webhook_enabled: false,
        provider_config: {},
      };

      mockPrismaService.projectIntegration.create.mockResolvedValue({
        id: 'pi-2',
        ...inputDto,
        access_token: null,
        refresh_token: null,
        webhook_secret: null,
      });

      await service.createIntegration(inputDto);

      expect(encryptionService.encrypt).not.toHaveBeenCalled();
    });
  });

  describe('updateIntegration', () => {
    it('should encrypt updated token fields and return plaintext', async () => {
      const updateData = {
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        token_expiry: new Date('2027-01-01'),
      };

      mockPrismaService.projectIntegration.update.mockResolvedValue({
        id: 'pi-1',
        project_id: 'proj-1',
        provider: 'CLICKUP',
        workspace_id: 'ws-1',
        workspace_name: 'My Workspace',
        access_token: 'encrypted_new-access-token',
        refresh_token: 'encrypted_new-refresh-token',
        webhook_secret: null,
        token_expiry: updateData.token_expiry,
        bot_user_id: null,
        bot_username: null,
        polling_enabled: false,
        polling_interval_min: 15,
        polling_last_run_at: null,
        webhook_enabled: false,
        webhook_id: null,
        provider_config: {},
        ai_trigger_status: null,
        created_at: new Date(),
        updated_at: new Date(),
      });

      const result = await service.updateIntegration('pi-1', updateData);

      expect(encryptionService.encrypt).toHaveBeenCalledTimes(2);
      expect(encryptionService.encrypt).toHaveBeenCalledWith('new-access-token');
      expect(encryptionService.encrypt).toHaveBeenCalledWith('new-refresh-token');
      expect(prismaService.projectIntegration.update).toHaveBeenCalledWith({
        where: { id: 'pi-1' },
        data: expect.objectContaining({
          access_token: 'encrypted_new-access-token',
          refresh_token: 'encrypted_new-refresh-token',
        }),
      });
      // Caller receives plaintext tokens
      expect(result.access_token).toBe('new-access-token');
      expect(result.refresh_token).toBe('new-refresh-token');
    });

    it('should not encrypt non-string token fields', async () => {
      mockPrismaService.projectIntegration.update.mockResolvedValue({
        id: 'pi-1',
        project_id: 'proj-1',
        provider: 'CLICKUP',
        workspace_id: 'ws-1',
        workspace_name: 'My Workspace',
        access_token: null,
        refresh_token: null,
        webhook_secret: null,
        token_expiry: null,
        bot_user_id: null,
        bot_username: null,
        polling_enabled: true,
        polling_interval_min: 15,
        polling_last_run_at: null,
        webhook_enabled: false,
        webhook_id: null,
        provider_config: {},
        ai_trigger_status: null,
        created_at: new Date(),
        updated_at: new Date(),
      });

      await service.updateIntegration('pi-1', { polling_enabled: true });

      expect(encryptionService.encrypt).not.toHaveBeenCalled();
    });
  });

  describe('findByProjectAndProvider', () => {
    it('should return decrypted integration when found', async () => {
      mockPrismaService.projectIntegration.findUnique.mockResolvedValue({
        id: 'pi-1',
        project_id: 'proj-1',
        provider: 'CLICKUP',
        workspace_id: 'ws-1',
        workspace_name: 'My Workspace',
        access_token: 'encrypted_access',
        refresh_token: 'encrypted_refresh',
        webhook_secret: 'encrypted_webhook',
        token_expiry: null,
        bot_user_id: null,
        bot_username: null,
        polling_enabled: true,
        polling_interval_min: 15,
        polling_last_run_at: null,
        webhook_enabled: false,
        webhook_id: null,
        provider_config: {},
        ai_trigger_status: null,
        created_at: new Date(),
        updated_at: new Date(),
      });

      const result = await service.findByProjectAndProvider('proj-1', 'CLICKUP' as any);

      expect(prismaService.projectIntegration.findUnique).toHaveBeenCalledWith({
        where: { project_id_provider: { project_id: 'proj-1', provider: 'CLICKUP' } },
      });
      expect(result).not.toBeNull();
      expect(result!.access_token).toBe('access');
      expect(result!.refresh_token).toBe('refresh');
      expect(result!.webhook_secret).toBe('webhook');
    });

    it('should return null when not found', async () => {
      mockPrismaService.projectIntegration.findUnique.mockResolvedValue(null);

      const result = await service.findByProjectAndProvider('proj-999', 'JIRA' as any);

      expect(result).toBeNull();
    });
  });

  describe('getDecryptedIntegration', () => {
    it('should decrypt tokens when retrieved from database', async () => {
      mockPrismaService.projectIntegration.findUnique.mockResolvedValue({
        id: 'pi-1',
        project_id: 'proj-1',
        provider: 'CLICKUP',
        workspace_id: 'ws-1',
        workspace_name: 'My Workspace',
        access_token: 'encrypted_access',
        refresh_token: 'encrypted_refresh',
        webhook_secret: 'encrypted_webhook',
        token_expiry: null,
        bot_user_id: null,
        bot_username: null,
        polling_enabled: false,
        polling_interval_min: 15,
        polling_last_run_at: null,
        webhook_enabled: false,
        webhook_id: null,
        provider_config: {},
        ai_trigger_status: null,
        created_at: new Date(),
        updated_at: new Date(),
      });

      const result = await service.getDecryptedIntegration('pi-1');

      expect(prismaService.projectIntegration.findUnique).toHaveBeenCalledWith({
        where: { id: 'pi-1' },
      });
      expect(encryptionService.decrypt).toHaveBeenCalledWith('encrypted_access');
      expect(encryptionService.decrypt).toHaveBeenCalledWith('encrypted_refresh');
      expect(encryptionService.decrypt).toHaveBeenCalledWith('encrypted_webhook');
      expect(result).toBeDefined();
      expect(result!.access_token).toBe('access');
      expect(result!.refresh_token).toBe('refresh');
      expect(result!.webhook_secret).toBe('webhook');
    });

    it('should return null when integration not found', async () => {
      mockPrismaService.projectIntegration.findUnique.mockResolvedValue(null);

      const result = await service.getDecryptedIntegration('nonexistent-id');

      expect(result).toBeNull();
    });

    it('should propagate decrypt errors with integration context', async () => {
      mockPrismaService.projectIntegration.findUnique.mockResolvedValue({
        id: 'pi-corrupt',
        project_id: 'proj-1',
        provider: 'CLICKUP',
        workspace_id: 'ws-1',
        workspace_name: 'My Workspace',
        access_token: 'malformed_not_encrypted',
        refresh_token: null,
        webhook_secret: null,
        token_expiry: null,
        bot_user_id: null,
        bot_username: null,
        polling_enabled: false,
        polling_interval_min: 15,
        polling_last_run_at: null,
        webhook_enabled: false,
        webhook_id: null,
        provider_config: {},
        ai_trigger_status: null,
        created_at: new Date(),
        updated_at: new Date(),
      });
      mockEncryptionService.decrypt.mockImplementationOnce(() => {
        throw new Error('Invalid encryption hash format');
      });

      await expect(service.getDecryptedIntegration('pi-corrupt')).rejects.toThrow(
        'Failed to decrypt tokens for integration pi-corrupt',
      );
    });
  });
});
