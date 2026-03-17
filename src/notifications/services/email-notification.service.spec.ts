import { Test, TestingModule } from '@nestjs/testing';
import { EmailNotificationService } from './email-notification.service';
import { ConfigService } from '@nestjs/config';
import * as sgMail from '@sendgrid/mail';
import * as fs from 'fs/promises';

jest.mock('@sendgrid/mail');
jest.mock('fs/promises');

describe('EmailNotificationService', () => {
  let service: EmailNotificationService;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let configService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailNotificationService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key) => {
              if (key === 'SENDGRID_API_KEY') return 'mock-api-key';
              if (key === 'EMAIL_FROM_ADDRESS') return 'test@dsf.com';
              return null;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<EmailNotificationService>(EmailNotificationService);
    configService = module.get(ConfigService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should send an email using SendGrid', async () => {
    (fs.access as jest.Mock).mockRejectedValue(new Error('Template not found')); // Use default
    (sgMail.send as jest.Mock).mockResolvedValue([{}] as any);

    await service.sendEmail('user-1', 'user@example.com', 'execution.completed', {
      projectName: 'Test',
    });

    expect(sgMail.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        from: 'test@dsf.com',
        subject: expect.stringContaining('Execution Completed'),
        html: expect.stringContaining('Notification: execution.completed'),
      }),
    );
  });

  it('should render template if available', async () => {
    (fs.access as jest.Mock).mockResolvedValue(undefined);
    (fs.readFile as jest.Mock).mockResolvedValue('<h1>{{projectName}}</h1>');
    (sgMail.send as jest.Mock).mockResolvedValue([{}] as any);

    await service.sendEmail('user-1', 'user@example.com', 'execution.completed', {
      projectName: 'Full Template',
    });

    expect(sgMail.send).toHaveBeenCalledWith(
      expect.objectContaining({
        html: expect.stringContaining('<h1>Full Template</h1>'),
      }),
    );
  });

  it('should handle SendGrid errors', async () => {
    (fs.access as jest.Mock).mockRejectedValue(new Error('No template'));
    (sgMail.send as jest.Mock).mockRejectedValue(new Error('SendGrid error'));

    await expect(service.sendEmail('user-1', 'u@e.com', 'ev', {})).rejects.toThrow(
      'SendGrid error',
    );
  });
});
