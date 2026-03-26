import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionGateway } from './execution.gateway';
import { JwtService } from '@nestjs/jwt';
import { MetricsService } from '@/common/metrics/metrics.service';
import { ExecutionStatus, AIProvider } from '@/prisma/client';

describe('ExecutionGateway', () => {
  let gateway: ExecutionGateway;
  let jwtService: JwtService;
  let metricsService: MetricsService;

  const mockServer = {
    to: jest.fn().mockReturnThis(),
    emit: jest.fn(),
  };

  const mockClient = {
    id: 'client-123',
    handshake: {
      auth: { token: 'valid-token' },
      headers: {},
    },
    disconnect: jest.fn(),
    join: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExecutionGateway,
        {
          provide: JwtService,
          useValue: {
            verifyAsync: jest.fn().mockResolvedValue({ sub: 'user-123' }),
          },
        },
        {
          provide: MetricsService,
          useValue: {
            incrementGauge: jest.fn(),
          },
        },
      ],
    }).compile();

    gateway = module.get<ExecutionGateway>(ExecutionGateway);
    jwtService = module.get<JwtService>(JwtService);
    metricsService = module.get<MetricsService>(MetricsService);

    gateway.server = mockServer as any;
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });

  describe('handleConnection', () => {
    it('should verify token and increment metrics', async () => {
      await gateway.handleConnection(mockClient as any);

      expect(jwtService.verifyAsync).toHaveBeenCalledWith('valid-token');
      expect(metricsService.incrementGauge).toHaveBeenCalledWith(
        'execution_socket_connections',
        1,
        { user_id: 'user-123' },
      );
    });

    it('should disconnect if token is missing', async () => {
      const clientWithoutToken = {
        id: 'bad-client',
        handshake: { auth: {}, headers: {} },
        disconnect: jest.fn(),
      } as any;
      await gateway.handleConnection(clientWithoutToken);

      expect((clientWithoutToken as any).disconnect).toHaveBeenCalled();
    });
  });

  describe('handleSubscribe', () => {
    it('should join the ticket room', () => {
      gateway.handleSubscribe(mockClient as any, 'ticket-123');

      expect(mockClient.join).toHaveBeenCalledWith('ticket_ticket-123');
    });
  });

  describe('emitProgress', () => {
    it('should emit progress update to ticket room', () => {
      const payload = {
        executionId: 'exec-123',
        ticketId: 'ticket-123',
        status: ExecutionStatus.IN_PROGRESS as ExecutionStatus,
        timestamp: new Date().toISOString(),
        aiProvider: AIProvider.CLAUDE_CODE as AIProvider,
      };

      gateway.emitProgress(payload);

      expect(mockServer.to).toHaveBeenCalledWith('ticket_ticket-123');
      expect(mockServer.emit).toHaveBeenCalledWith('execution-progress-update', payload);
    });
  });

  describe('emitCompletion', () => {
    it('should emit completion event to ticket room', () => {
      gateway.emitCompletion('exec-123', 'ticket-123');

      expect(mockServer.to).toHaveBeenCalledWith('ticket_ticket-123');
      expect(mockServer.emit).toHaveBeenCalledWith('execution-completed', {
        executionId: 'exec-123',
        ticketId: 'ticket-123',
      });
    });
  });
});
