import { SkillModelMapAdminController } from './skill-model-map-admin.controller';
import { SkillModelMapAdminService } from './skill-model-map-admin.service';

describe('SkillModelMapAdminController', () => {
  let controller: SkillModelMapAdminController;
  let adminService: Record<string, unknown>;

  beforeEach(() => {
    adminService = {
      listEntries: jest.fn().mockResolvedValue([{ skill: 'clickup-qa' }]),
      updateEntry: jest.fn().mockResolvedValue({ skill: 'clickup-qa', model: 'opus' }),
    };
    controller = new SkillModelMapAdminController(
      adminService as unknown as SkillModelMapAdminService,
    );
  });

  it('list() delegates to the admin service', async () => {
    const result = await controller.list();

    expect(result).toEqual([{ skill: 'clickup-qa' }]);
    expect(adminService.listEntries).toHaveBeenCalled();
  });

  it('update() delegates to the admin service with the skill param, dto, and requesting user id', async () => {
    const dto = { model: 'opus', provider: 'claude', runtime: 'claude' };
    const req = { user: { id: 'user-1' } } as any;

    const result = await controller.update('clickup-qa', dto, req);

    expect(result).toEqual({ skill: 'clickup-qa', model: 'opus' });
    expect(adminService.updateEntry).toHaveBeenCalledWith('clickup-qa', dto, 'user-1');
  });
});
