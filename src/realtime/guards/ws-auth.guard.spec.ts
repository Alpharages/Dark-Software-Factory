import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Socket } from 'socket.io';
import { WsAuthGuard } from './ws-auth.guard';

describe('WsAuthGuard', () => {
  let guard: WsAuthGuard;
  let jwtService: JwtService;
  let mockClient: Partial<Socket>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WsAuthGuard,
        {
          provide: JwtService,
          useValue: {
            verifyAsync: jest.fn(),
          },
        },
      ],
    }).compile();

    guard = module.get<WsAuthGuard>(WsAuthGuard);
    jwtService = module.get<JwtService>(JwtService);

    // Mock Socket client
    mockClient = {
      id: 'test-socket-id',
      disconnect: jest.fn(),
      handshake: {
        auth: {},
        headers: {},
        query: {},
        address: '127.0.0.1',
      } as unknown as Socket['handshake'],
      data: {},
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('canActivate', () => {
    it('should authenticate valid token from auth object', async () => {
      mockClient.handshake!.auth.token = 'valid-token';
      const mockPayload = {
        sub: 'user-123',
        roles: ['admin', 'developer'],
        email: 'test@example.com',
      };
      jest.spyOn(jwtService, 'verifyAsync').mockResolvedValue(mockPayload);

      const mockContext = createMockContext(mockClient);
      const result = await guard.canActivate(mockContext);

      expect(result).toBe(true);
      expect(jwtService.verifyAsync).toHaveBeenCalledWith('valid-token');
      expect(mockClient.data.user).toEqual({
        userId: 'user-123',
        roles: ['admin', 'developer'],
        email: 'test@example.com',
      });
    });

    it('should authenticate valid token from Authorization header', async () => {
      mockClient.handshake!.headers.authorization = 'Bearer header-token';
      const mockPayload = {
        sub: 'user-456',
        roles: ['pm'],
        email: 'pm@example.com',
      };
      jest.spyOn(jwtService, 'verifyAsync').mockResolvedValue(mockPayload);

      const mockContext = createMockContext(mockClient);
      const result = await guard.canActivate(mockContext);

      expect(result).toBe(true);
      expect(jwtService.verifyAsync).toHaveBeenCalledWith('header-token');
      expect(mockClient.data.user?.userId).toBe('user-456');
    });

    it('should authenticate valid token from query parameter', async () => {
      mockClient.handshake!.query.token = 'query-token';
      const mockPayload = {
        sub: 'user-789',
        roles: [],
        email: 'user@example.com',
      };
      jest.spyOn(jwtService, 'verifyAsync').mockResolvedValue(mockPayload);

      const mockContext = createMockContext(mockClient);
      const result = await guard.canActivate(mockContext);

      expect(result).toBe(true);
      expect(jwtService.verifyAsync).toHaveBeenCalledWith('query-token');
    });

    it('should disconnect client when no token provided', async () => {
      const mockContext = createMockContext(mockClient);
      const result = await guard.canActivate(mockContext);

      expect(result).toBe(false);
      expect(mockClient.disconnect).toHaveBeenCalled();
    });

    it('should disconnect client on invalid token', async () => {
      mockClient.handshake!.auth.token = 'invalid-token';
      jest.spyOn(jwtService, 'verifyAsync').mockRejectedValue(new Error('Invalid token'));

      const mockContext = createMockContext(mockClient);
      const result = await guard.canActivate(mockContext);

      expect(result).toBe(false);
      expect(mockClient.disconnect).toHaveBeenCalled();
    });

    it('should disconnect client on expired token', async () => {
      mockClient.handshake!.auth.token = 'expired-token';
      jest.spyOn(jwtService, 'verifyAsync').mockRejectedValue(new Error('Token expired'));

      const mockContext = createMockContext(mockClient);
      const result = await guard.canActivate(mockContext);

      expect(result).toBe(false);
      expect(mockClient.disconnect).toHaveBeenCalled();
    });

    it('should handle malformed Authorization header', async () => {
      mockClient.handshake!.headers.authorization = 'InvalidFormat';

      const mockContext = createMockContext(mockClient);
      const result = await guard.canActivate(mockContext);

      expect(result).toBe(false);
      expect(mockClient.disconnect).toHaveBeenCalled();
    });
  });

  /**
   * Helper to create mock ExecutionContext for WebSocket
   */
  function createMockContext(client: Partial<Socket>): ExecutionContext {
    return {
      switchToWs: () => ({
        getClient: () => client,
        getData: () => ({}),
      }),
    } as ExecutionContext;
  }
});
