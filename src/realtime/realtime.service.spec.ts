import { Test, TestingModule } from '@nestjs/testing';
import { Server } from 'socket.io';
import { RealtimeService } from './realtime.service';
import { NotificationDispatcherService } from '../notifications/services/notification-dispatcher.service';

describe('RealtimeService', () => {
  let service: RealtimeService;
  let mockServer: Partial<Server>;
  let mockNotificationDispatcher: Partial<NotificationDispatcherService>;

  beforeEach(async () => {
    mockNotificationDispatcher = {
      dispatch: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RealtimeService,
        {
          provide: NotificationDispatcherService,
          useValue: mockNotificationDispatcher,
        },
      ],
    }).compile();

    service = module.get<RealtimeService>(RealtimeService);

    // Mock Socket.IO Server
    mockServer = {
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('setServer', () => {
    it('should set the server instance', () => {
      service.setServer(mockServer as Server);
      // Server is set, no error should occur on emit calls
      service.emitToProject('project-1', 'test.event', { data: 'test' });
      expect(mockServer.to).toHaveBeenCalledWith('project:project-1');
    });
  });

  describe('emitToProject', () => {
    it('should emit event to project room', () => {
      service.setServer(mockServer as Server);
      const payload = { status: 'completed', percentage: 100 };

      service.emitToProject('project-123', 'execution.progress', payload);

      expect(mockServer.to).toHaveBeenCalledWith('project:project-123');
      expect(mockServer.emit).toHaveBeenCalledWith('execution.progress', payload);
    });

    it('should warn if server not initialized', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      service.emitToProject('project-1', 'test', {});
      // Server not set, should log warning but not crash
      expect(mockServer.to).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should handle multiple projects', () => {
      service.setServer(mockServer as Server);

      service.emitToProject('project-1', 'event-1', { data: 1 });
      service.emitToProject('project-2', 'event-2', { data: 2 });

      expect(mockServer.to).toHaveBeenCalledWith('project:project-1');
      expect(mockServer.to).toHaveBeenCalledWith('project:project-2');
    });
  });

  describe('emitToRole', () => {
    it('should emit event to role room', () => {
      service.setServer(mockServer as Server);
      const payload = { message: 'System maintenance scheduled' };

      service.emitToRole('admin', 'system.alert', payload);

      expect(mockServer.to).toHaveBeenCalledWith('role:admin');
      expect(mockServer.emit).toHaveBeenCalledWith('system.alert', payload);
    });

    it('should handle multiple roles', () => {
      service.setServer(mockServer as Server);

      service.emitToRole('admin', 'alert-1', { severity: 'high' });
      service.emitToRole('pm', 'alert-2', { severity: 'low' });
      service.emitToRole('developer', 'alert-3', { severity: 'medium' });

      expect(mockServer.to).toHaveBeenCalledWith('role:admin');
      expect(mockServer.to).toHaveBeenCalledWith('role:pm');
      expect(mockServer.to).toHaveBeenCalledWith('role:developer');
    });
  });

  describe('emitToUser', () => {
    it('should emit event to specific user room', () => {
      service.setServer(mockServer as Server);
      const payload = { ticketId: 'TICK-123', status: 'assigned' };

      service.emitToUser('user-456', 'ticket.updated', payload);

      expect(mockServer.to).toHaveBeenCalledWith('user:user-456');
      expect(mockServer.emit).toHaveBeenCalledWith('ticket.updated', payload);
    });

    it('should handle multiple users independently', () => {
      service.setServer(mockServer as Server);

      service.emitToUser('user-1', 'notification', { message: 'Hello user 1' });
      service.emitToUser('user-2', 'notification', { message: 'Hello user 2' });

      expect(mockServer.to).toHaveBeenCalledWith('user:user-1');
      expect(mockServer.to).toHaveBeenCalledWith('user:user-2');
    });
  });

  describe('broadcast', () => {
    it('should broadcast event to all connected clients', () => {
      service.setServer(mockServer as Server);
      const payload = { severity: 'critical', message: 'System outage' };

      service.broadcast('system.alert', payload);

      expect(mockServer.emit).toHaveBeenCalledWith('system.alert', payload);
      expect(mockServer.to).not.toHaveBeenCalled(); // Broadcast doesn't use rooms
    });
  });

  describe('graceful degradation', () => {
    it('should not crash when emitting before server initialization', () => {
      expect(() => {
        service.emitToProject('project-1', 'event', {});
        service.emitToRole('admin', 'event', {});
        service.emitToUser('user-1', 'event', {});
        service.broadcast('event', {});
      }).not.toThrow();
    });
  });
});
