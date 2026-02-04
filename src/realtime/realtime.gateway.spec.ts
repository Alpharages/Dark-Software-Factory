import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeService } from './realtime.service';
import { MetricsService } from '@/common/metrics/metrics.service';
import { JoinProjectDto, LeaveProjectDto } from './dto/join-room.dto';

describe('RealtimeGateway', () => {
  let gateway: RealtimeGateway;
  let jwtService: JwtService;
  let metricsService: MetricsService;
  let realtimeService: RealtimeService;
  let mockServer: Partial<Server>;
  let mockClient: Partial<Socket>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RealtimeGateway,
        {
          provide: JwtService,
          useValue: {
            verifyAsync: jest.fn(),
          },
        },
        {
          provide: MetricsService,
          useValue: {
            incrementGauge: jest.fn(),
            incrementCounter: jest.fn(),
          },
        },
        {
          provide: RealtimeService,
          useValue: {
            setServer: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: string) => {
              if (key === 'FRONTEND_URL') return 'http://localhost:5173';
              return defaultValue;
            }),
          },
        },
      ],
    }).compile();

    gateway = module.get<RealtimeGateway>(RealtimeGateway);
    jwtService = module.get<JwtService>(JwtService);
    metricsService = module.get<MetricsService>(MetricsService);
    realtimeService = module.get<RealtimeService>(RealtimeService);

    mockServer = {
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
    };

    mockClient = {
      id: 'test-socket-id',
      disconnect: jest.fn(),
      join: jest.fn(),
      leave: jest.fn(),
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

  describe('afterInit', () => {
    it('should initialize gateway and register server with RealtimeService', () => {
      gateway.afterInit(mockServer as Server);

      expect(realtimeService.setServer).toHaveBeenCalledWith(mockServer);
    });
  });

  describe('handleConnection', () => {
    it('should authenticate client and join user and role rooms', async () => {
      mockClient.handshake!.auth.token = 'valid-token';
      const mockPayload = {
        sub: 'user-123',
        roles: ['admin', 'developer'],
        email: 'test@example.com',
      };
      jest.spyOn(jwtService, 'verifyAsync').mockResolvedValue(mockPayload);

      await gateway.handleConnection(mockClient as Socket);

      expect(jwtService.verifyAsync).toHaveBeenCalledWith('valid-token');
      expect(mockClient.data.user).toEqual({
        userId: 'user-123',
        roles: ['admin', 'developer'],
        email: 'test@example.com',
      });
      expect(mockClient.join).toHaveBeenCalledWith('user:user-123');
      expect(mockClient.join).toHaveBeenCalledWith('role:admin');
      expect(mockClient.join).toHaveBeenCalledWith('role:developer');
      expect(metricsService.incrementGauge).toHaveBeenCalledWith(
        'websocket_active_connections',
        1,
        { user_id: 'user-123' },
      );
    });

    it('should disconnect client when token is missing', async () => {
      await gateway.handleConnection(mockClient as Socket);

      expect(mockClient.disconnect).toHaveBeenCalled();
      expect(metricsService.incrementCounter).toHaveBeenCalledWith('websocket_connection_errors', {
        reason: 'missing_token',
      });
    });

    it('should disconnect client on JWT verification failure', async () => {
      mockClient.handshake!.auth.token = 'invalid-token';
      jest.spyOn(jwtService, 'verifyAsync').mockRejectedValue(new Error('Token invalid'));

      await gateway.handleConnection(mockClient as Socket);

      expect(mockClient.disconnect).toHaveBeenCalled();
      expect(metricsService.incrementCounter).toHaveBeenCalledWith('websocket_connection_errors', {
        reason: 'auth_failed',
      });
    });

    it('should extract token from Authorization header', async () => {
      mockClient.handshake!.headers.authorization = 'Bearer header-token';
      const mockPayload = { sub: 'user-456', roles: [], email: 'user@example.com' };
      jest.spyOn(jwtService, 'verifyAsync').mockResolvedValue(mockPayload);

      await gateway.handleConnection(mockClient as Socket);

      expect(jwtService.verifyAsync).toHaveBeenCalledWith('header-token');
      expect(mockClient.data.user?.userId).toBe('user-456');
    });

    it('should extract token from query parameter', async () => {
      mockClient.handshake!.query.token = 'query-token';
      const mockPayload = { sub: 'user-789', roles: [], email: 'user@example.com' };
      jest.spyOn(jwtService, 'verifyAsync').mockResolvedValue(mockPayload);

      await gateway.handleConnection(mockClient as Socket);

      expect(jwtService.verifyAsync).toHaveBeenCalledWith('query-token');
    });
  });

  describe('handleDisconnect', () => {
    it('should log disconnection and decrement active connections metric', () => {
      mockClient.data = {
        user: {
          userId: 'user-123',
          roles: ['admin'],
          email: 'test@example.com',
        },
      };

      gateway.handleDisconnect(mockClient as Socket);

      expect(metricsService.incrementGauge).toHaveBeenCalledWith(
        'websocket_active_connections',
        -1,
        { user_id: 'user-123' },
      );
    });

    it('should handle disconnection when user context is missing', () => {
      mockClient.data = {};

      gateway.handleDisconnect(mockClient as Socket);

      expect(metricsService.incrementGauge).toHaveBeenCalledWith(
        'websocket_active_connections',
        -1,
        { user_id: 'unknown' },
      );
    });
  });

  describe('handleJoinProject', () => {
    it('should allow authenticated user to join project room', async () => {
      mockClient.data = {
        user: { userId: 'user-123', roles: ['developer'], email: 'dev@example.com' },
      };
      const dto: JoinProjectDto = { projectId: 'project-456' };

      const result = await gateway.handleJoinProject(mockClient as Socket, dto);

      expect(mockClient.join).toHaveBeenCalledWith('project:project-456');
      expect(result).toEqual({ status: 'ok', room: 'project:project-456' });
      expect(metricsService.incrementCounter).toHaveBeenCalledWith('websocket_events_total', {
        event: 'joinProject',
      });
    });

    it('should join multiple projects independently', async () => {
      mockClient.data = {
        user: { userId: 'user-123', roles: [], email: 'user@example.com' },
      };

      await gateway.handleJoinProject(mockClient as Socket, { projectId: 'project-1' });
      await gateway.handleJoinProject(mockClient as Socket, { projectId: 'project-2' });

      expect(mockClient.join).toHaveBeenCalledWith('project:project-1');
      expect(mockClient.join).toHaveBeenCalledWith('project:project-2');
    });
  });

  describe('handleLeaveProject', () => {
    it('should allow user to leave project room', () => {
      const dto: LeaveProjectDto = { projectId: 'project-789' };

      const result = gateway.handleLeaveProject(mockClient as Socket, dto);

      expect(mockClient.leave).toHaveBeenCalledWith('project:project-789');
      expect(result).toEqual({ status: 'ok', room: 'project:project-789' });
      expect(metricsService.incrementCounter).toHaveBeenCalledWith('websocket_events_total', {
        event: 'leaveProject',
      });
    });
  });

  describe('token extraction priority', () => {
    it('should prioritize auth.token over Authorization header', async () => {
      mockClient.handshake!.auth.token = 'auth-token';
      mockClient.handshake!.headers.authorization = 'Bearer header-token';
      const mockPayload = { sub: 'user-123', roles: [], email: 'user@example.com' };
      jest.spyOn(jwtService, 'verifyAsync').mockResolvedValue(mockPayload);

      await gateway.handleConnection(mockClient as Socket);

      expect(jwtService.verifyAsync).toHaveBeenCalledWith('auth-token');
    });

    it('should fall back to Authorization header if auth.token missing', async () => {
      mockClient.handshake!.headers.authorization = 'Bearer fallback-token';
      const mockPayload = { sub: 'user-456', roles: [], email: 'user@example.com' };
      jest.spyOn(jwtService, 'verifyAsync').mockResolvedValue(mockPayload);

      await gateway.handleConnection(mockClient as Socket);

      expect(jwtService.verifyAsync).toHaveBeenCalledWith('fallback-token');
    });

    it('should fall back to query parameter if all else missing', async () => {
      mockClient.handshake!.query.token = 'last-resort-token';
      const mockPayload = { sub: 'user-789', roles: [], email: 'user@example.com' };
      jest.spyOn(jwtService, 'verifyAsync').mockResolvedValue(mockPayload);

      await gateway.handleConnection(mockClient as Socket);

      expect(jwtService.verifyAsync).toHaveBeenCalledWith('last-resort-token');
    });
  });
});
