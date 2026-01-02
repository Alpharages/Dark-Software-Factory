import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { Role } from '../constants/roles.enum';
import { ForbiddenException } from '@nestjs/common';

describe('UsersController', () => {
  let controller: UsersController;
  let _service: UsersService;

  const mockUsersService = {
    listUsers: jest.fn(),
    getUserById: jest.fn(),
    updateUser: jest.fn(),
    deactivateUser: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        {
          provide: UsersService,
          useValue: mockUsersService,
        },
      ],
    }).compile();

    controller = module.get<UsersController>(UsersController);
    _service = module.get<UsersService>(UsersService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('listUsers', () => {
    it('should return paginated list of users', async () => {
      const mockResponse = {
        users: [
          {
            id: '1',
            email: 'user@test.com',
            fullName: 'Test User',
            role: Role.PM,
            isActive: true,
          },
        ],
        pagination: {
          page: 1,
          limit: 20,
          total: 1,
          totalPages: 1,
          hasNext: false,
          hasPrevious: false,
        },
      };

      mockUsersService.listUsers.mockResolvedValue(mockResponse);

      const result = await controller.listUsers({ page: 1, limit: 20 });

      expect(result).toEqual(mockResponse);
      expect(mockUsersService.listUsers).toHaveBeenCalledWith({
        page: 1,
        limit: 20,
      });
    });
  });

  describe('getUserById', () => {
    it('should return user details for valid UUID', async () => {
      const mockUser = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        email: 'user@test.com',
        fullName: 'Test User',
        role: Role.PM,
        isActive: true,
        lastLoginAt: null,
        createdAt: new Date(),
        invitationsSentCount: 5,
        activeRefreshTokensCount: 2,
      };

      mockUsersService.getUserById.mockResolvedValue(mockUser);

      const result = await controller.getUserById('123e4567-e89b-12d3-a456-426614174000');

      expect(result).toEqual(mockUser);
    });

    // Note: Invalid UUID format is handled by ParseUUIDPipe and would throw 400
    // This test would require integration testing to verify the pipe behavior
  });

  describe('updateUser', () => {
    it('should update user successfully', async () => {
      const userId = '123e4567-e89b-12d3-a456-426614174000';
      const adminUserId = 'admin-123-e89b-12d3-a456-426614174000';
      const updateDto = { role: Role.TL };

      const mockUpdatedUser = {
        id: userId,
        email: 'user@test.com',
        fullName: 'Test User',
        role: Role.TL,
        isActive: true,
      };

      mockUsersService.updateUser.mockResolvedValue(mockUpdatedUser);

      const req = { user: { id: adminUserId, email: 'admin@test.com', role: 'ADMIN' } };
      const result = await controller.updateUser(userId, updateDto, req);

      expect(result).toEqual(mockUpdatedUser);
      expect(mockUsersService.updateUser).toHaveBeenCalledWith(userId, updateDto, adminUserId);
    });

    it('should throw ForbiddenException when trying to modify own account', async () => {
      const userId = '123e4567-e89b-12d3-a456-426614174000';
      const req = { user: { id: userId, email: 'user@test.com', role: 'ADMIN' } };

      mockUsersService.updateUser.mockRejectedValue(
        new ForbiddenException(
          'Cannot modify your own account through this endpoint. Use /auth/me for profile updates.',
        ),
      );

      await expect(controller.updateUser(userId, { role: Role.ADMIN }, req)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('deactivateUser', () => {
    it('should deactivate user successfully', async () => {
      const userId = '123e4567-e89b-12d3-a456-426614174000';
      const adminUserId = 'admin-123-e89b-12d3-a456-426614174000';

      const mockResponse = {
        message: 'User deactivated successfully',
        userId,
      };

      mockUsersService.deactivateUser.mockResolvedValue(mockResponse);

      const req = { user: { id: adminUserId, email: 'admin@test.com', role: 'ADMIN' } };
      const result = await controller.deactivateUser(userId, req);

      expect(result).toEqual(mockResponse);
      expect(mockUsersService.deactivateUser).toHaveBeenCalledWith(userId, adminUserId);
    });

    it('should throw ForbiddenException when trying to deactivate own account', async () => {
      const userId = '123e4567-e89b-12d3-a456-426614174000';
      const req = { user: { id: userId, email: 'user@test.com', role: 'ADMIN' } };

      mockUsersService.deactivateUser.mockRejectedValue(
        new ForbiddenException('Cannot deactivate your own account'),
      );

      await expect(controller.deactivateUser(userId, req)).rejects.toThrow(ForbiddenException);
    });
  });
});
