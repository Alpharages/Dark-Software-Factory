import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { WorkspaceService } from './workspace.service';
import * as fs from 'fs/promises';
import { constants } from 'fs';
import * as path from 'path';
import { InfrastructureException } from '@/common/exceptions/infrastructure.exception';

jest.mock('fs/promises');

describe('WorkspaceService', () => {
  let service: WorkspaceService;
  let configService: ConfigService;
  const mockMkdir = fs.mkdir as jest.Mock;
  const mockAccess = fs.access as jest.Mock;
  const mockChmod = fs.chmod as jest.Mock;

  beforeEach(async () => {
    jest.resetAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkspaceService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue: any) => {
              if (key === 'SANDBOX_WORKSPACES_ROOT') return '/tmp/workspaces';
              return defaultValue;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<WorkspaceService>(WorkspaceService);
    configService = module.get<ConfigService>(ConfigService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createWorkspace', () => {
    it('should create a workspace directory with absolute path', async () => {
      mockMkdir.mockResolvedValue(undefined);
      mockAccess.mockResolvedValue(undefined); // Permissions OK
      mockChmod.mockResolvedValue(undefined);

      const ticketId = 'ticket-123';
      const expectedPath = path.resolve('/tmp/workspaces/ticket-123');

      const result = await service.createWorkspace(ticketId);

      expect(configService.get).toHaveBeenCalledWith('SANDBOX_WORKSPACES_ROOT', expect.any(String));
      expect(fs.mkdir).toHaveBeenCalledWith(expectedPath, { recursive: true });
      expect(fs.chmod).toHaveBeenCalledWith(expectedPath, 0o777);
      expect(result).toBe(expectedPath);
    });

    it('should throw InfrastructureException if mkdir fails', async () => {
      mockMkdir.mockRejectedValue(new Error('mkdir failed'));
      await expect(service.createWorkspace('ticket-123')).rejects.toThrow(InfrastructureException);
    });
  });

  describe('verifyPermissions', () => {
    it('should pass if directory is writable', async () => {
      mockAccess.mockResolvedValue(undefined);
      await service.verifyPermissions('/path');
      expect(fs.access).toHaveBeenCalledWith('/path', constants.R_OK | constants.W_OK);
    });

    it('should throw InfrastructureException if directory is not writable', async () => {
      mockAccess.mockRejectedValue(new Error('EACCES'));
      await expect(service.verifyPermissions('/path')).rejects.toThrow(InfrastructureException);
    });
  });
});
