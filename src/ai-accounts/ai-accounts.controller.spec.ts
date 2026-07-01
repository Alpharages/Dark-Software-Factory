import { BadRequestException } from '@nestjs/common';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Role } from '@/auth/constants/roles.enum';
import { AiAccountsController } from './ai-accounts.controller';
import { AiAccountsService } from './ai-accounts.service';

describe('AiAccountsController', () => {
  let controller: AiAccountsController;
  let service: Record<string, jest.Mock>;

  beforeEach(() => {
    service = {
      importFromCsv: jest.fn().mockResolvedValue({ imported: 2, skipped: 0, errors: [] }),
      list: jest.fn().mockResolvedValue([{ id: 'a', label: 'claude-1', enabled: true }]),
      setEnabled: jest.fn().mockResolvedValue({ id: 'a', enabled: false }),
    };
    controller = new AiAccountsController(service as unknown as AiAccountsService);
  });

  it('import() forwards the uploaded file buffer to the service', async () => {
    const file = { buffer: Buffer.from('csv') } as Express.Multer.File;
    const result = await controller.import(file);

    expect(result).toEqual({ imported: 2, skipped: 0, errors: [] });
    expect(service.importFromCsv).toHaveBeenCalledWith(file.buffer);
  });

  it('import() returns only counts + redacted errors, never credential data', async () => {
    const result = await controller.import({ buffer: Buffer.from('x') } as Express.Multer.File);
    expect(Object.keys(result)).toEqual(['imported', 'skipped', 'errors']);
  });

  it('import() rejects a missing file with 400', async () => {
    await expect(controller.import(undefined)).rejects.toThrow(BadRequestException);
    expect(service.importFromCsv).not.toHaveBeenCalled();
  });

  it('list() delegates and returns redacted rows (no credentials)', async () => {
    const result = await controller.list();
    expect(result[0]).not.toHaveProperty('credentials');
    expect(service.list).toHaveBeenCalled();
  });

  it('setEnabled() delegates the id + dto.enabled to the service', async () => {
    const result = await controller.setEnabled('a', { enabled: false });
    expect(result).toEqual({ id: 'a', enabled: false });
    expect(service.setEnabled).toHaveBeenCalledWith('a', false);
  });

  it('every route is ADMIN-guarded (RolesGuard + @Roles(ADMIN))', () => {
    for (const method of ['import', 'list', 'setEnabled'] as const) {
      const roles = Reflect.getMetadata('roles', controller[method]);
      expect(roles).toEqual([Role.ADMIN]);
    }
    const guards = Reflect.getMetadata('__guards__', AiAccountsController);
    expect(guards).toContain(RolesGuard);
  });
});
