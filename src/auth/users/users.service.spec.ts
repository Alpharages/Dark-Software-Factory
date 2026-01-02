import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { PrismaService } from '../../database/prisma.service';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { Role } from '../constants/roles.enum';

describe('UsersService', () => {
  let service: UsersService;
  let _prisma: PrismaService;

  const mockPrismaService = {
    user: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    userInvitation: {
      count: jest.fn(),
    },
    refreshToken: {
      count: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    _prisma = module.get<PrismaService>(PrismaService);

    // Clear all mocks before each test
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('listUsers', () => {
    it('should return paginated user list successfully', async () => {
      const mockUsers = [
        {
          id: '1',
          email: 'user1@test.com',
          full_name: 'User One',
          role: Role.PM,
          is_active: true,
        },
      ];

      mockPrismaService.user.findMany.mockResolvedValue(mockUsers);
      mockPrismaService.user.count.mockResolvedValue(1);

      const result = await service.listUsers({ page: 1, limit: 20 });

      expect(result.users).toHaveLength(1);
      expect(result.users[0].email).toBe('user1@test.com');
      expect(result.pagination.total).toBe(1);
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.hasNext).toBe(false);
      expect(result.pagination.hasPrevious).toBe(false);
    });

    it('should apply role filter correctly', async () => {
      mockPrismaService.user.findMany.mockResolvedValue([]);
      mockPrismaService.user.count.mockResolvedValue(0);

      await service.listUsers({ role: Role.ADMIN });

      expect(mockPrismaService.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { role: Role.ADMIN },
        }),
      );
    });

    it('should apply isActive filter correctly', async () => {
      mockPrismaService.user.findMany.mockResolvedValue([]);
      mockPrismaService.user.count.mockResolvedValue(0);

      await service.listUsers({ isActive: true });

      expect(mockPrismaService.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { is_active: true },
        }),
      );
    });

    it('should apply search filter correctly', async () => {
      mockPrismaService.user.findMany.mockResolvedValue([]);
      mockPrismaService.user.count.mockResolvedValue(0);

      await service.listUsers({ search: 'test' });

      expect(mockPrismaService.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { email: { contains: 'test', mode: 'insensitive' } },
              { full_name: { contains: 'test', mode: 'insensitive' } },
            ],
          },
        }),
      );
    });

    it('should calculate pagination correctly for page 2', async () => {
      mockPrismaService.user.findMany.mockResolvedValue([]);
      mockPrismaService.user.count.mockResolvedValue(50);

      const result = await service.listUsers({ page: 2, limit: 20 });

      expect(mockPrismaService.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 20,
          take: 20,
        }),
      );

      expect(result.pagination.page).toBe(2);
      expect(result.pagination.totalPages).toBe(3);
      expect(result.pagination.hasNext).toBe(true);
      expect(result.pagination.hasPrevious).toBe(true);
    });
  });

  describe('getUserById', () => {
    it('should return user details successfully', async () => {
      const mockUser = {
        id: '1',
        email: 'user@test.com',
        full_name: 'Test User',
        role: Role.PM,
        is_active: true,
        last_login_at: new Date(),
        created_at: new Date(),
      };

      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      mockPrismaService.userInvitation.count.mockResolvedValue(5);
      mockPrismaService.refreshToken.count.mockResolvedValue(2);

      const result = await service.getUserById('1');

      expect(result.id).toBe('1');
      expect(result.email).toBe('user@test.com');
      expect(result.invitationsSentCount).toBe(5);
      expect(result.activeRefreshTokensCount).toBe(2);
    });

    it('should throw NotFoundException if user not found', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(service.getUserById('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateUser', () => {
    const adminId = 'admin-123';
    const userId = 'user-123';

    it('should update role and isActive successfully', async () => {
      const existingUser = {
        id: userId,
        email: 'user@test.com',
        full_name: 'Test User',
        role: Role.PM,
        is_active: true,
      };

      const updatedUser = {
        ...existingUser,
        role: Role.TL,
        is_active: false,
      };

      mockPrismaService.user.findUnique.mockResolvedValueOnce(existingUser);
      mockPrismaService.user.update.mockResolvedValue(updatedUser);
      mockPrismaService.user.findUnique.mockResolvedValueOnce({
        email: 'admin@test.com',
      });

      const result = await service.updateUser(userId, { role: Role.TL, isActive: false }, adminId);

      expect(result.role).toBe(Role.TL);
      expect(result.isActive).toBe(false);
    });

    it('should throw ForbiddenException when admin tries to modify their own account', async () => {
      await expect(service.updateUser(adminId, { role: Role.ADMIN }, adminId)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw NotFoundException if user not found', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(service.updateUser('nonexistent', { role: Role.TL }, adminId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('deactivateUser', () => {
    const adminId = 'admin-123';
    const userId = 'user-123';

    it('should deactivate user and revoke tokens successfully', async () => {
      const mockUser = {
        id: userId,
        email: 'user@test.com',
        is_active: true,
      };

      mockPrismaService.user.findUnique.mockResolvedValueOnce(mockUser);
      mockPrismaService.$transaction.mockResolvedValue([{}, {}]);
      mockPrismaService.user.findUnique.mockResolvedValueOnce({
        email: 'admin@test.com',
      });

      const result = await service.deactivateUser(userId, adminId);

      expect(result.message).toBe('User deactivated successfully');
      expect(result.userId).toBe(userId);
      expect(mockPrismaService.$transaction).toHaveBeenCalled();
    });

    it('should throw ForbiddenException when admin tries to deactivate themselves', async () => {
      await expect(service.deactivateUser(adminId, adminId)).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException if user not found', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(service.deactivateUser('nonexistent', adminId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should be idempotent - return success even if user already deactivated', async () => {
      const mockUser = {
        id: userId,
        email: 'user@test.com',
        is_active: false, // Already deactivated
      };

      mockPrismaService.user.findUnique.mockResolvedValueOnce(mockUser);
      mockPrismaService.$transaction.mockResolvedValue([{}, {}]);
      mockPrismaService.user.findUnique.mockResolvedValueOnce({
        email: 'admin@test.com',
      });

      const result = await service.deactivateUser(userId, adminId);

      expect(result.message).toBe('User deactivated successfully');
    });
  });
});
