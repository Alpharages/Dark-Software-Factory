import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../database/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException, ForbiddenException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { Role } from './constants/roles.enum';

jest.mock('bcrypt');

describe('AuthService', () => {
  let service: AuthService;

  const mockUser = {
    id: 'user-1',
    email: 'test@example.com',
    password_hash: 'hashedPassword',
    full_name: 'Test User',
    role: Role.PM,
    is_active: true,
    last_login_at: null,
  };

  const mockPrismaService = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    refreshToken: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn((callback) => callback),
  };

  const mockJwtService = {
    sign: jest.fn(() => 'token'),
    verifyAsync: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: JwtService, useValue: mockJwtService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('login', () => {
    const loginDto = { email: 'test@example.com', password: 'password' };

    it('should return tokens on successful login', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      mockPrismaService.$transaction.mockResolvedValue([{}, {}]);

      const result = await service.login(loginDto);

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result.user.email).toBe(mockUser.email);
      expect(mockPrismaService.user.update).toHaveBeenCalled();
    });

    it('should throw UnauthorizedException on invalid email', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(service.login(loginDto)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException on invalid password', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login(loginDto)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw ForbiddenException if user is inactive', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({ ...mockUser, is_active: false });

      await expect(service.login(loginDto)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('refreshAccessToken', () => {
    const refreshToken = 'valid-refresh-token';

    it('should return new access token', async () => {
      mockJwtService.verifyAsync.mockResolvedValue({
        sub: 'user-1',
        type: 'refresh',
        jti: 'token-id',
      });
      mockPrismaService.refreshToken.findUnique.mockResolvedValue({
        token_id: 'token-id',
        is_revoked: false,
      });
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.refreshAccessToken(refreshToken);

      expect(result).toHaveProperty('accessToken');
    });

    it('should throw UnauthorizedException on revoked token', async () => {
      mockJwtService.verifyAsync.mockResolvedValue({
        sub: 'user-1',
        type: 'refresh',
        jti: 'token-id',
      });
      mockPrismaService.refreshToken.findUnique.mockResolvedValue({
        token_id: 'token-id',
        is_revoked: true,
      });

      await expect(service.refreshAccessToken(refreshToken)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException on invalid token type', async () => {
      mockJwtService.verifyAsync.mockResolvedValue({
        sub: 'user-1',
        type: 'access',
        jti: 'token-id',
      });

      await expect(service.refreshAccessToken(refreshToken)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('logout', () => {
    const refreshToken = 'valid-refresh-token';

    it('should mark token as revoked', async () => {
      mockJwtService.verifyAsync.mockResolvedValue({
        sub: 'user-1',
        type: 'refresh',
        jti: 'token-id',
      });

      await service.logout(refreshToken);

      expect(mockPrismaService.refreshToken.update).toHaveBeenCalledWith({
        where: { token_id: 'token-id' },
        data: { is_revoked: true },
      });
    });

    it('should handle errors gracefully (idempotency)', async () => {
      mockJwtService.verifyAsync.mockRejectedValue(new Error('Invalid token'));

      await expect(service.logout(refreshToken)).resolves.not.toThrow();
    });
  });

  describe('getCurrentUser', () => {
    it('should return user profile', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.getCurrentUser('user-1');

      expect(result.email).toBe(mockUser.email);
    });

    it('should throw UnauthorizedException if user not found', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(service.getCurrentUser('user-1')).rejects.toThrow(UnauthorizedException);
    });
  });
});
