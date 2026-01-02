import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException, HttpException, HttpStatus } from '@nestjs/common';
import { RegistrationController } from './registration.controller';
import { RegistrationService } from './registration.service';
import { RegisterUserDto } from '../dto/register-user.dto';
import { RegisterResponseDto } from '../dto/register-response.dto';
import { Role } from '../constants/roles.enum';

describe('RegistrationController', () => {
  let controller: RegistrationController;
  let service: RegistrationService;

  const mockRegistrationService = {
    register: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RegistrationController],
      providers: [
        {
          provide: RegistrationService,
          useValue: mockRegistrationService,
        },
      ],
    }).compile();

    controller = module.get<RegistrationController>(RegistrationController);
    service = module.get<RegistrationService>(RegistrationService);

    jest.clearAllMocks();
  });

  describe('POST /auth/register', () => {
    const validDto: RegisterUserDto = {
      inviteToken: 'valid-token-123',
      password: 'SecureP@ss123',
      fullName: 'John Doe',
    };

    const successResponse: RegisterResponseDto = {
      accessToken: 'jwt-token-123',
      user: {
        id: 'user-uuid-123',
        email: 'john.doe@example.com',
        fullName: 'John Doe',
        role: Role.PM,
        isActive: true,
      },
    };

    it('should successfully register a user with valid invite token', async () => {
      mockRegistrationService.register.mockResolvedValue(successResponse);

      const result = await controller.register(validDto);

      expect(service.register).toHaveBeenCalledWith(validDto);
      expect(result).toEqual(successResponse);
      expect(result.accessToken).toBeDefined();
      expect(result.user.email).toEqual('john.doe@example.com');
    });

    it('should return 400 Bad Request for invalid DTO (password too weak)', async () => {
      const invalidDto = {
        inviteToken: 'valid-token',
        password: 'weak', // Too short, no uppercase, no special char
        fullName: 'John Doe',
      };

      mockRegistrationService.register.mockRejectedValue(
        new BadRequestException('Password requirements not met'),
      );

      await expect(controller.register(invalidDto as RegisterUserDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should return 404 Not Found for invalid invite token', async () => {
      mockRegistrationService.register.mockRejectedValue(
        new NotFoundException('Invite token not found'),
      );

      await expect(controller.register(validDto)).rejects.toThrow(NotFoundException);
    });

    it('should return 409 Conflict if user already exists', async () => {
      mockRegistrationService.register.mockRejectedValue(
        new HttpException('User already exists', HttpStatus.CONFLICT),
      );

      await expect(controller.register(validDto)).rejects.toThrow(HttpException);
      await expect(controller.register(validDto)).rejects.toMatchObject({
        status: HttpStatus.CONFLICT,
      });
    });

    it('should return 410 Gone for expired invite token', async () => {
      mockRegistrationService.register.mockRejectedValue(
        new HttpException('Invitation has expired', HttpStatus.GONE),
      );

      await expect(controller.register(validDto)).rejects.toThrow(HttpException);
      await expect(controller.register(validDto)).rejects.toMatchObject({
        status: HttpStatus.GONE,
      });
    });
  });
});
