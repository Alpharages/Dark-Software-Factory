import { Test, TestingModule } from '@nestjs/testing';
import { NotificationDispatcherService } from './notification-dispatcher.service';
import { NotificationPreferenceRepository } from '../repositories/notification-preference.repository';
import { SlackNotificationService } from './slack-notification.service';
import { EmailNotificationService } from './email-notification.service';
import { InAppNotificationService } from './in-app-notification.service';
import { UsersService } from '../../auth/users/users.service';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { Counter } from 'prom-client';

const getMetricToken = (name: string): string => `PROM_METRIC_${name.toUpperCase()}`;

describe('NotificationDispatcherService', () => {
  let service: NotificationDispatcherService;
  let preferenceRepo: jest.Mocked<NotificationPreferenceRepository>;
  let slackService: jest.Mocked<SlackNotificationService>;
  let emailService: jest.Mocked<EmailNotificationService>;
  let inAppService: jest.Mocked<InAppNotificationService>;
  let usersService: jest.Mocked<UsersService>;
  let auditLogService: jest.Mocked<AuditLogService>;
  let dispatchedCounter: jest.Mocked<Counter<string>>;
  let failedCounter: jest.Mocked<Counter<string>>;

  const mockUser = {
    id: 'user-1',
    email: 'test@example.com',
    slackMemberId: 'U123456',
    full_name: 'Test User',
    role: 'USER',
    is_active: true,
  } as const;

  beforeEach(async () => {
    dispatchedCounter = { inc: jest.fn() } as unknown as jest.Mocked<Counter<string>>;
    failedCounter = { inc: jest.fn() } as unknown as jest.Mocked<Counter<string>>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationDispatcherService,
        {
          provide: NotificationPreferenceRepository,
          useValue: { findByUserAndEventType: jest.fn() },
        },
        {
          provide: SlackNotificationService,
          useValue: { sendSlackMessage: jest.fn() },
        },
        {
          provide: EmailNotificationService,
          useValue: { sendEmail: jest.fn() },
        },
        {
          provide: InAppNotificationService,
          useValue: { createNotification: jest.fn() },
        },
        {
          provide: UsersService,
          useValue: { getUserById: jest.fn() },
        },
        {
          provide: AuditLogService,
          useValue: { log: jest.fn() },
        },
        {
          provide: getMetricToken('notifications_dispatched_total'),
          useValue: dispatchedCounter,
        },
        {
          provide: getMetricToken('notifications_failed_total'),
          useValue: failedCounter,
        },
      ],
    }).compile();

    service = module.get<NotificationDispatcherService>(NotificationDispatcherService);
    preferenceRepo = module.get(NotificationPreferenceRepository);
    slackService = module.get(SlackNotificationService);
    emailService = module.get(EmailNotificationService);
    inAppService = module.get(InAppNotificationService);
    usersService = module.get(UsersService);
    auditLogService = module.get(AuditLogService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('dispatch', () => {
    const event = {
      userId: 'user-1',
      eventType: 'execution.completed',
      title: 'Job Done',
      message: 'Your job finished successfully',
      payload: { projectId: 'project-1', severity: 'info' },
    };

    it('should dispatch to In-App by default if no preferences found', async () => {
      usersService.getUserById.mockResolvedValue(mockUser as any);
      preferenceRepo.findByUserAndEventType.mockResolvedValue(null);

      inAppService.createNotification.mockResolvedValue({} as any);

      await service.dispatch(event);

      expect(inAppService.createNotification).toHaveBeenCalledWith(
        event.userId,
        event.eventType,
        event.title,
        event.message,
        event.payload,
      );
      expect(dispatchedCounter.inc).toHaveBeenCalledWith(
        expect.objectContaining({ channel: 'in_app' }),
      );
    });

    it('should respect user channel preferences', async () => {
      usersService.getUserById.mockResolvedValue(mockUser as any);

      preferenceRepo.findByUserAndEventType.mockResolvedValue({
        enabled: true,
        channels: ['slack', 'email'],
        filterCriteria: null,
      } as any);
      slackService.sendSlackMessage.mockResolvedValue(undefined);
      emailService.sendEmail.mockResolvedValue(undefined);

      await service.dispatch(event);

      expect(slackService.sendSlackMessage).toHaveBeenCalled();
      expect(emailService.sendEmail).toHaveBeenCalled();
      expect(inAppService.createNotification).not.toHaveBeenCalled();
    });

    it('should filter out notifications based on criteria', async () => {
      usersService.getUserById.mockResolvedValue(mockUser as any);

      preferenceRepo.findByUserAndEventType.mockResolvedValue({
        enabled: true,
        channels: ['in_app'],
        filterCriteria: { severity: ['error'] }, // Only error
      } as any);

      await service.dispatch(event); // event has severity 'info'

      expect(inAppService.createNotification).not.toHaveBeenCalled();
      expect(dispatchedCounter.inc).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'filtered' }),
      );
    });

    it('should rate limit frequent notifications', async () => {
      usersService.getUserById.mockResolvedValue(mockUser as any);
      preferenceRepo.findByUserAndEventType.mockResolvedValue(null);

      // Force rate limit by calling many times (or mocking isRateLimited)
      // Since isRateLimited is private, we'll just test the behavior
      for (let i = 0; i < 100; i++) {
        await service.dispatch(event);
      }
      jest.clearAllMocks();

      await service.dispatch(event); // 101st call

      expect(inAppService.createNotification).not.toHaveBeenCalled();
      expect(failedCounter.inc).toHaveBeenCalledWith(expect.objectContaining({ channel: 'all' }));
    });

    it('should log an audit record after successful dispatch', async () => {
      usersService.getUserById.mockResolvedValue(mockUser as any);
      preferenceRepo.findByUserAndEventType.mockResolvedValue(null);

      inAppService.createNotification.mockResolvedValue({} as any);

      await service.dispatch(event);

      expect(auditLogService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'DISPATCH',
          entityType: 'Notification',
        }),
      );
    });
  });
});
