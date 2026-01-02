import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from '../common/guards/auth.guard';
import { Role } from './constants/roles.enum';

describe('AuthController', () => {
  let controller: AuthController;

  const mockAuthService = {
    login: jest.fn(),
    refreshAccessToken: jest.fn(),
    logout: jest.fn(),
    getCurrentUser: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: mockAuthService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('login', () => {
    it('should return tokens', async () => {
      const dto = { email: 'test@example.com', password: 'password' };
      const expectedResult = {
        accessToken: 'token',
        refreshToken: 'refresh',
        user: {
          id: '1',
          email: 'test@example.com',
          fullName: 'Test',
          role: Role.PM,
          isActive: true,
        },
      };

      mockAuthService.login.mockResolvedValue(expectedResult);

      expect(await controller.login(dto)).toBe(expectedResult);
    });
  });

  describe('refresh', () => {
    it('should return new access token', async () => {
      const dto = { refreshToken: 'refresh' };
      const expectedResult = { accessToken: 'new-token' };

      mockAuthService.refreshAccessToken.mockResolvedValue(expectedResult);

      expect(await controller.refresh(dto)).toBe(expectedResult);
    });
  });

  describe('logout', () => {
    it('should return success message', async () => {
      const dto = { refreshToken: 'refresh' };

      const result = await controller.logout(dto);

      expect(result).toEqual({ message: 'Successfully logged out' });
      expect(mockAuthService.logout).toHaveBeenCalledWith(dto.refreshToken);
    });
  });

  describe('getCurrentUser', () => {
    it('should return user profile', async () => {
      const req = { user: { sub: 'user-1' } };
      const expectedResult = { id: 'user-1', email: 'test@example.com' };

      mockAuthService.getCurrentUser.mockResolvedValue(expectedResult);

      expect(await controller.getCurrentUser(req)).toBe(expectedResult);
    });
  });
});
