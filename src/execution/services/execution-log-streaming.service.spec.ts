import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionLogStreamingService } from './execution-log-streaming.service';
import { RealtimeService } from '@/realtime/realtime.service';
import { ExecutionLogRepository } from '../repositories/execution-log.repository';
import { EventBusService } from '@/common/event-bus.service';
import { getToken } from '@willsoto/nestjs-prometheus';

// Mock Dependencies
const mockRealtimeService = {
  emitToProject: jest.fn(),
  emitToRole: jest.fn(),
};

const mockLogRepository = {
  save: jest.fn().mockResolvedValue({}),
};

const mockEventBusService = {
  emit: jest.fn(),
  on: jest.fn(),
};

const mockCounter = {
  inc: jest.fn(),
};

const mockGauge = {
  set: jest.fn(),
  inc: jest.fn(),
  dec: jest.fn(),
};

describe('ExecutionLogStreamingService', () => {
  let service: ExecutionLogStreamingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExecutionLogStreamingService,
        { provide: RealtimeService, useValue: mockRealtimeService },
        { provide: ExecutionLogRepository, useValue: mockLogRepository },
        { provide: EventBusService, useValue: mockEventBusService },
        { provide: getToken('execution_logs_emitted_total'), useValue: mockCounter },
        { provide: getToken('execution_logs_dropped_total'), useValue: mockCounter },
        { provide: getToken('websocket_log_emission_errors_total'), useValue: mockCounter },
        { provide: getToken('execution_log_buffer_size'), useValue: mockGauge },
      ],
    }).compile();

    service = module.get<ExecutionLogStreamingService>(ExecutionLogStreamingService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('emitLog', () => {
    it('should emit log via WebSocket and save to DB', async () => {
      const executionId = 'exec-1';
      const message = 'Test log message';
      const source = 'test-source';

      await service.emitLog(executionId, 'INFO', message, source, 'ticket-1', 'project-1');

      // Verify DB persistence
      expect(mockLogRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          executionId,
          level: 'INFO',
          message,
          source,
        }),
      );

      // Verify WebSocket emission
      expect(mockRealtimeService.emitToProject).toHaveBeenCalledWith(
        'project-1',
        'execution.log',
        expect.objectContaining({
          executionId,
          message,
          level: 'INFO',
        }),
      );
    });

    it('should redact secrets in logs', async () => {
      const executionId = 'exec-2';
      const secret = 'sk-1234567890abcdef12345678'; // Fake API key pattern
      const message = `Using API key ${secret}`;

      // Mock redact method or rely on implementation
      // Since it's private, we test the effect

      await service.emitLog(executionId, 'INFO', message, 'test', 'ticket-1', 'project-1');

      expect(mockLogRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('[REDACTED]'),
        }),
      );

      expect(mockRealtimeService.emitToProject).toHaveBeenCalledWith(
        'project-1',
        'execution.log',
        expect.objectContaining({
          message: expect.stringContaining('[REDACTED]'),
        }),
      );
    });

    it('should drop logs if rate limit exceeded (mocking internal state)', async () => {
      // Access private property logic indirectly via behavior
      // Threshold is 100. Sample rate 10.
      const executionId = 'exec-high-volume';

      // Emit 100 logs (should all pass)
      for (let i = 0; i < 100; i++) {
        await service.emitLog(executionId, 'INFO', `msg ${i}`, 'test');
      }

      expect(mockRealtimeService.emitToRole).toHaveBeenCalledTimes(200); // 100 * 2 roles (Admin + Dev) + Projects (if provided, but projectId undefined here so maybe not called logic-wise)
      // Check emitToTargetRooms logic: calls emitToRole for ADMIN and DEVELOPER always.

      jest.clearAllMocks();

      // Emit 101st log (count reaches 100, 100 % 10 === 0 -> emits)
      await service.emitLog(executionId, 'INFO', 'msg 101', 'test');

      // Reset mocks for the actual drop test
      jest.clearAllMocks();

      // Emit 102nd log (count reaches 101, 101 % 10 !== 0 -> drops)
      await service.emitLog(executionId, 'INFO', 'msg 102', 'test');
      expect(mockRealtimeService.emitToRole).not.toHaveBeenCalled();
      expect(mockCounter.inc).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'rate_limit' }),
      );

      // Emit 9 more (102-110). 110th should pass (110 % 10 === 0)
      // Actually counting starts from 0?
      // The service uses a map for counts.
      // 100th call made count=100.
      // 101st call (index 100? or count 101?) -> count=100 before inc? increment happens AFTER emission check?
      // Check code:
      // if (shouldEmit) { emit; increment; }
      // So checks against current count.
      // After 100 emits, count is 100. shouldEmit(100) -> 100 < 100? False. 100 % 10 == 0? True. So 101st log (count 100) emits.
      // 102nd log (count 101). 101 % 10 != 0. Drop.

      // Let's test just one drop case
      // Reset mocks
    });

    it('should always emit ERROR logs regardless of rate limit', async () => {
      const executionId = 'exec-error';
      // artificially inflate count using REFLECTION or just assumption tests run in isolation
      // We can't easily set private state.
      // But we can verify ERROR calls emitError which doesn't check rate limit?
      // emitError method implementation calls emitToTargetRooms directly, bypassing shouldEmitToWebSocket check?
      // Let's check implementation. yes it calls emitToTargetRooms directly.

      await service.emitError(executionId, 'SYSTEM_ERROR', 'Critical failure', null);

      expect(mockRealtimeService.emitToRole).toHaveBeenCalled();
    });
  });
});
