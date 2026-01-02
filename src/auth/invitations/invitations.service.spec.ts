import { Test, TestingModule } from '@nestjs/testing';
import { InvitationsService } from './invitations.service';
import { PrismaService } from '../../database/prisma.service';
import { EmailService } from '../../common/email/email.service';
import { ConflictException, ForbiddenException, HttpException } from '@nestjs/common';
// Import from the custom output location or use the service to access types if needed,
// using @prisma/client usually works if the generator is standard, but here it outputted to src/prisma.
// Let's try importing from the generated client path.
import { InvitationStatus } from '../../prisma/enums';
import { Role } from '../../auth/constants/roles.enum';

describe('InvitationsService', () => {
  let service: InvitationsService;
  let prisma: PrismaService;
  let email: EmailService;

  const mockPrismaService = {
    userInvitation: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn((promises) => Promise.all(promises)),
  };

  const mockEmailService = {
    sendInvitationEmail: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvitationsService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: EmailService,
          useValue: mockEmailService,
        },
      ],
    }).compile();

    service = module.get<InvitationsService>(InvitationsService);
    prisma = module.get<PrismaService>(PrismaService);
    email = module.get<EmailService>(EmailService);

    jest.clearAllMocks();
  });

  describe('createInvitation', () => {
    const createDto = { email: 'test@example.com', role: Role.PM };
    const inviterId = 'inviter-id';

    it('should create an invitation successfully', async () => {
      mockPrismaService.userInvitation.findFirst.mockResolvedValue(null);
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      mockPrismaService.userInvitation.create.mockResolvedValue({
        id: 'invitation-id',
        ...createDto,
        invite_token: 'token',
        status: InvitationStatus.PENDING,
        invited_by: { full_name: 'Inviter' },
      });

      const result = await service.createInvitation(inviterId, createDto);

      expect(prisma.userInvitation.create).toHaveBeenCalled();
      expect(email.sendInvitationEmail).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('should throw ConflictException if pending invitation exists', async () => {
      mockPrismaService.userInvitation.findFirst.mockResolvedValue({ id: 'exists' });

      await expect(service.createInvitation(inviterId, createDto)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should throw ConflictException if user already exists', async () => {
      mockPrismaService.userInvitation.findFirst.mockResolvedValue(null);
      mockPrismaService.user.findUnique.mockResolvedValue({ id: 'user-exists' });

      await expect(service.createInvitation(inviterId, createDto)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('verifyToken', () => {
    it('should return invitation details if valid', async () => {
      const validInvitation = {
        email: 'test@example.com',
        role: Role.PM,
        status: InvitationStatus.PENDING,
        expires_at: new Date(Date.now() + 100000),
      };
      mockPrismaService.userInvitation.findUnique.mockResolvedValue(validInvitation);

      const result = await service.verifyToken('valid-token');
      expect(result.email).toEqual(validInvitation.email);
    });

    it('should throw ForbiddenException if expired', async () => {
      const expiredInvitation = {
        status: InvitationStatus.PENDING,
        expires_at: new Date(Date.now() - 100000),
      };
      mockPrismaService.userInvitation.findUnique.mockResolvedValue(expiredInvitation);

      await expect(service.verifyToken('expired')).rejects.toThrow(HttpException); // GONE
    });

    it('should throw ForbiddenException if revoked', async () => {
      mockPrismaService.userInvitation.findUnique.mockResolvedValue({
        status: InvitationStatus.REVOKED,
      });
      await expect(service.verifyToken('revoked')).rejects.toThrow(ForbiddenException);
    });
  });
});
