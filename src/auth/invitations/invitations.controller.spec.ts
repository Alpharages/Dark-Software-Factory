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
      const serviceResult = {
        id: 'uuid',
        ...dto,
        status: 'PENDING',
        invite_token: 'token',
        expires_at: new Date(),
        created_at: new Date(),
        invited_by: { id: 'admin-id', email: 'admin@example.com', full_name: 'Admin' },
      };

      const expectedResult = {
        id: 'uuid',
        ...dto,
        status: 'PENDING',
        inviteToken: 'token',
        expiresAt: serviceResult.expires_at,
        createdAt: serviceResult.created_at,
        invitedBy: { id: 'admin-id', email: 'admin@example.com', fullName: 'Admin' },
      };

      jest.spyOn(service, 'createInvitation').mockResolvedValue(serviceResult as any);

      expect(await controller.create('admin-id', dto)).toEqual(expectedResult);
    });
  });

  describe('remove', () => {
    it('should revoke an invitation', async () => {
      jest
        .spyOn(service, 'revokeInvitation')

        .mockResolvedValue({ id: 'uuid', status: 'REVOKED' } as any);

      await controller.remove('uuid');
      expect(service.revokeInvitation).toHaveBeenCalledWith('uuid');
    });
  });
});
