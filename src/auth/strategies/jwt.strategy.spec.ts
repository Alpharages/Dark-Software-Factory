import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '../../common/logger';
import { JwtStrategy } from './jwt.strategy';
import { Role } from '../constants/roles.enum';
import { JwtPayload } from '../interfaces/jwt-payload.interface';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockImplementation((key: string) => {
              if (key === 'auth.jwtSecret') {
                return 'test-secret-at-least-32-characters-long';
              }
              return undefined;
            }),
          },
        },
        {
          provide: LoggerService,
          useValue: {
            setContext: jest.fn(),
            log: jest.fn(),
            error: jest.fn(),
            warn: jest.fn(),
            debug: jest.fn(),
          },
        },
      ],
    }).compile();

    strategy = module.get<JwtStrategy>(JwtStrategy);
  });

  it('should be defined', () => {
    expect(strategy).toBeDefined();
  });

  describe('validate', () => {
    it('should return authenticated user for valid payload', async () => {
      const payload: JwtPayload = {
        sub: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        role: Role.PM,
      };

      const result = await strategy.validate(payload);

      expect(result).toEqual({
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        role: Role.PM,
        permissions: expect.arrayContaining(['CREATE_TICKET', 'VIEW_DASHBOARDS']),
      });
    });

    it('should throw UnauthorizedException for missing sub', async () => {
      const payload: JwtPayload = {
        sub: '',
        email: 'test@example.com',
        name: 'Test User',
        role: Role.PM,
      };

      await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException for missing role', async () => {
      const payload = {
        sub: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
      } as JwtPayload;

      await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException for invalid role', async () => {
      const payload = {
        sub: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        role: 'INVALID_ROLE',
      } as unknown as JwtPayload;

      await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
    });

    it('should include direct permissions in result', async () => {
      const payload: JwtPayload = {
        sub: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        role: Role.VIEWER,
        permissions: ['CUSTOM_PERMISSION'],
      };

      const result = await strategy.validate(payload);

      expect(result.permissions).toContain('CUSTOM_PERMISSION');
      expect(result.permissions).toContain('VIEW_DASHBOARDS');
    });
  });
});
