/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test, TestingModule } from '@nestjs/testing';
import { SlackNotificationService } from './slack-notification.service';
import { ConfigService } from '@nestjs/config';

jest.mock('@slack/web-api', () => {
  return {
    WebClient: jest.fn().mockImplementation(() => ({
      chat: {
        postMessage: jest.fn().mockResolvedValue({ ok: true }),
      },
    })),
  };
});

describe('SlackNotificationService', () => {
  let service: SlackNotificationService;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let configService: jest.Mocked<ConfigService>;

  let mockSlackClient: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SlackNotificationService,
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('mock-token') },
        },
      ],
    }).compile();

    service = module.get<SlackNotificationService>(SlackNotificationService);
    configService = module.get(ConfigService);
    mockSlackClient = (service as any).slackClient;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should send a slack message with formatted blocks', async () => {
    const userId = 'user-1';
    const eventType = 'execution.completed';
    const payload = { projectName: 'Test Project', message: 'Success', severity: 'info' };
    const slackMemberId = 'U12345';

    await service.sendSlackMessage(userId, eventType, payload, slackMemberId);

    expect(mockSlackClient.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: slackMemberId,
        blocks: expect.arrayContaining([
          expect.objectContaining({ type: 'header' }),
          expect.objectContaining({ type: 'section' }),
        ]),
      }),
    );
  });

  it('should handle slack API errors', async () => {
    mockSlackClient.chat.postMessage.mockRejectedValue(new Error('Slack error'));

    await expect(service.sendSlackMessage('user-1', 'event', {}, 'U123')).rejects.toThrow(
      'Slack error',
    );
  });

  it('should not send if slackMemberId is missing', async () => {
    const loggerSpy = jest.spyOn((service as any).logger, 'warn');
    await service.sendSlackMessage('user-1', 'event', {}, undefined);
    expect(mockSlackClient.chat.postMessage).not.toHaveBeenCalled();
    expect(loggerSpy).toHaveBeenCalledWith(expect.stringContaining('No Slack member ID provided'));
  });
});
