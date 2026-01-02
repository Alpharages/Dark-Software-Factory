import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, InternalServerErrorException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { RegistrationService } from './registration.service';
import { PrismaService } from '../../database/prisma.service';
import { InvitationsService } from '../invitations/invitations.service';
import { RegisterUserDto } from '../dto/register-user.dto';
import { Role } from '../constants/roles.enum';

// Mock bcrypt
jest.mock('bcrypt');

describe('RegistrationService', () => {
  let service: RegistrationService;
  let prisma: PrismaService;
  let invitationsService: InvitationsService;
  let jwtService: JwtService;

  const mockPrismaService = {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    userInvitation: {
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockInvitationsService = {
    verifyToken: jest.fn(),
  };

  const mockJwtService = {
    sign: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RegistrationService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: InvitationsService,
          useValue: mockInvitationsService,
        },
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
      ],
    }).compile();

    service = module.get<RegistrationService>(RegistrationService);
    prisma = module.get<PrismaService>(PrismaService);
    invitationsService = module.get<InvitationsService>(InvitationsService);
    jwtService = module.get<JwtService>(JwtService);

    jest.clearAllMocks();
  });

  describe('register', () => {
    const validDto: RegisterUserDto = {
      inviteToken: 'valid-token-123',
      password: 'SecureP@ss123',
      fullName: 'John Doe',
    };

    const validInvitation = {
      email: 'john.doe@example.com',
      role: Role.PM,
      expiresAt: new Date(Date.now() + 100000),
    };

    it('should successfully register a user and return JWT token', async () => {
      // Setup mocks
      mockInvitationsService.verifyToken.mockResolvedValue(validInvitation);
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');

      const createdUser = {
        id: 'user-uuid-123',
        email: validInvitation.email,
        full_name: validDto.fullName,
        role: validInvitation.role,
        is_active: true,
        password_hash: 'hashed-password',
      };

      // Mock transaction
      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        return await callback({
          user: {
            create: jest.fn().mockResolvedValue(createdUser),
          },
          userInvitation: {
            update: jest.fn().mockResolvedValue({}),
          },
        });
      });

      mockJwtService.sign.mockReturnValue('jwt-token-123');

      // Execute
      const result = await service.register(validDto);

      // Verify
      expect(invitationsService.verifyToken).toHaveBeenCalledWith(validDto.inviteToken);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: validInvitation.email },
      });
      expect(bcrypt.hash).toHaveBeenCalledWith(validDto.password, 12);
      expect(jwtService.sign).toHaveBeenCalledWith({
        sub: createdUser.id,
        email: createdUser.email,
        role: createdUser.role,
      });

      expect(result).toEqual({
        accessToken: 'jwt-token-123',
        user: {
          id: createdUser.id,
          email: createdUser.email,
          fullName: createdUser.full_name,
          role: createdUser.role,
          isActive: createdUser.is_active,
        },
      });
    });

    it('should throw ConflictException if user already exists with invitation email', async () => {
      // Setup
      mockInvitationsService.verifyToken.mockResolvedValue(validInvitation);
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'existing-user',
        email: validInvitation.email,
      });

      // Execute & Verify
      await expect(service.register(validDto)).rejects.toThrow(ConflictException);
      await expect(service.register(validDto)).rejects.toThrow(
        'User already exists with this email',
      );
    });

    it('should propagate InvitationsService errors (404, 400, 410, 403)', async () => {
      const notFoundError = { status: 404, message: 'Invitation token not found' };
      mockInvitationsService.verifyToken.mockRejectedValue(notFoundError);

      await expect(service.register(validDto)).rejects.toEqual(notFoundError);
    });

    it('should call bcrypt.hash with cost factor 12', async () => {
      mockInvitationsService.verifyToken.mockResolvedValue(validInvitation);
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');

      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        return await callback({
          user: {
            create: jest.fn().mockResolvedValue({
              id: 'user-uuid',
              email: validInvitation.email,
              full_name: validDto.fullName,
              role: validInvitation.role,
              is_active: true,
            }),
          },
          userInvitation: {
            update: jest.fn().mockResolvedValue({}),
          },
        });
      });

      mockJwtService.sign.mockReturnValue('jwt-token');

      await service.register(validDto);

      expect(bcrypt.hash).toHaveBeenCalledWith(validDto.password, 12);
    });

    it('should use atomic transaction for user creation and invitation update', async () => {
      mockInvitationsService.verifyToken.mockResolvedValue(validInvitation);
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');

      const transactionCallback = jest.fn();
      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        transactionCallback();
        return await callback({
          user: {
            create: jest.fn().mockResolvedValue({
              id: 'user-uuid',
              email: validInvitation.email,
              full_name: validDto.fullName,
              role: validInvitation.role,
              is_active: true,
            }),
          },
          userInvitation: {
            update: jest.fn().mockResolvedValue({}),
          },
        });
      });

      mockJwtService.sign.mockReturnValue('jwt-token');

      await service.register(validDto);

      // Verify transaction was called
      expect(transactionCallback).toHaveBeenCalled();
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('should throw InternalServerErrorException for unexpected database errors', async () => {
      mockInvitationsService.verifyToken.mockResolvedValue(validInvitation);
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');

      // Simulate database error
      mockPrismaService.$transaction.mockRejectedValue(new Error('Database connection failed'));

      await expect(service.register(validDto)).rejects.toThrow(InternalServerErrorException);
      await expect(service.register(validDto)).rejects.toThrow(
        'Registration failed. Please try again later.',
      );
    });

    it('should NOT include password_hash in response', async () => {
      mockInvitationsService.verifyToken.mockResolvedValue(validInvitation);
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');

      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        return await callback({
          user: {
            create: jest.fn().mockResolvedValue({
              id: 'user-uuid',
              email: validInvitation.email,
              full_name: validDto.fullName,
              role: validInvitation.role,
              is_active: true,
              password_hash: 'hashed-password', // This should not be in response
            }),
          },
          userInvitation: {
            update: jest.fn().mockResolvedValue({}),
          },
        });
      });

      mockJwtService.sign.mockReturnValue('jwt-token');

      const result = await service.register(validDto);

      expect(result.user).not.toHaveProperty('password_hash');
    });
  });
});
