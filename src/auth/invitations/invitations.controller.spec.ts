import { Test, TestingModule } from '@nestjs/testing';
import { InvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';
import { Role } from '../../auth/constants/roles.enum';
import { CreateInvitationDto } from './dto/create-invitation.dto';

describe('InvitationsController', () => {
  let controller: InvitationsController;
  let service: InvitationsService;

  const mockInvitationsService = {
    createInvitation: jest.fn(),
    listInvitations: jest.fn(),
    revokeInvitation: jest.fn(),
    verifyToken: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [InvitationsController],
      providers: [
        {
          provide: InvitationsService,
          useValue: mockInvitationsService,
        },
      ],
    }).compile();

    controller = module.get<InvitationsController>(InvitationsController);
    service = module.get<InvitationsService>(InvitationsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('should create an invitation', async () => {
      const dto: CreateInvitationDto = { email: 'test@example.com', role: Role.PM };
      const expectedResult = {
        id: 'uuid',
        ...dto,
        status: 'PENDING',
        inviteToken: 'token',
        expiresAt: new Date(),
        createdAt: new Date(),
        invitedBy: { id: 'admin-id', email: 'admin@example.com', fullName: 'Admin' },
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      jest.spyOn(service, 'createInvitation').mockResolvedValue(expectedResult as any);

      expect(await controller.create('admin-id', dto)).toEqual(expectedResult);
    });
  });

  describe('remove', () => {
    it('should revoke an invitation', async () => {
      jest
        .spyOn(service, 'revokeInvitation')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .mockResolvedValue({ id: 'uuid', status: 'REVOKED' } as any);

      await controller.remove('uuid');
      expect(service.revokeInvitation).toHaveBeenCalledWith('uuid');
    });
  });
});
