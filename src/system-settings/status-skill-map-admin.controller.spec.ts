import { StatusSkillMapAdminController } from './status-skill-map-admin.controller';
import { StatusSkillMapAdminService } from './status-skill-map-admin.service';
import { OpenHarnessSkill } from '@/openharness/skills.enum';

describe('StatusSkillMapAdminController', () => {
  let controller: StatusSkillMapAdminController;
  let adminService: Record<string, unknown>;

  beforeEach(() => {
    adminService = {
      getGlobalMap: jest
        .fn()
        .mockResolvedValue({ entries: [], loopTerminalStatuses: [], loopMaxIterations: 5 }),
      setGlobalMap: jest.fn().mockResolvedValue([]),
    };
    controller = new StatusSkillMapAdminController(
      adminService as unknown as StatusSkillMapAdminService,
    );
  });

  it('delegates GET to adminService.getGlobalMap', async () => {
    await controller.getGlobalMap();
    expect(adminService.getGlobalMap).toHaveBeenCalled();
  });

  it('delegates PUT to adminService.setGlobalMap with the caller id', async () => {
    const dto = { entries: [{ status: 'approved', skill: OpenHarnessSkill.CLICKUP_QA }] };
    const req = { user: { id: 'user-42' } } as any;

    await controller.setGlobalMap(dto, req);

    expect(adminService.setGlobalMap).toHaveBeenCalledWith(dto.entries, 'user-42');
  });
});
