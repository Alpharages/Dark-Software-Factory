import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AppService } from './app.service';
import { SandboxService } from './sandbox/sandbox.service';

describe('AppService', () => {
  let appService: AppService;
  let configService: jest.Mocked<ConfigService>;
  let sandboxService: jest.Mocked<Partial<SandboxService>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppService,
        {
          provide: ConfigService,
          useValue: { get: jest.fn() },
        },
        {
          provide: SandboxService,
          useValue: { isHealthy: jest.fn() },
        },
      ],
    }).compile();

    appService = module.get<AppService>(AppService);
    configService = module.get(ConfigService);
    sandboxService = module.get(SandboxService) as jest.Mocked<Partial<SandboxService>>;
  });

  describe('getHello', () => {
    it('should return "Hello World!"', () => {
      expect(appService.getHello()).toBe('Hello World!');
    });
  });

  describe('getIntegrationHealth', () => {
    it('should return true for sandbox when SandboxService reports healthy', async () => {
      (sandboxService.isHealthy as jest.Mock).mockResolvedValue(true);
      (configService.get as jest.Mock).mockReturnValue(undefined);

      const result = await appService.getIntegrationHealth();

      expect(result.sandbox).toBe(true);
    });

    it('should return false for sandbox when SandboxService reports unhealthy', async () => {
      (sandboxService.isHealthy as jest.Mock).mockResolvedValue(false);
      (configService.get as jest.Mock).mockReturnValue(undefined);

      const result = await appService.getIntegrationHealth();

      expect(result.sandbox).toBe(false);
    });

    it('should return false for sandbox when SandboxService throws', async () => {
      (sandboxService.isHealthy as jest.Mock).mockRejectedValue(
        new Error('SandboxService connection failed'),
      );
      (configService.get as jest.Mock).mockReturnValue(undefined);

      const result = await appService.getIntegrationHealth();

      expect(result.sandbox).toBe(false);
    });

    it('should return true for each integration when env vars are present', async () => {
      (sandboxService.isHealthy as jest.Mock).mockResolvedValue(true);
      (configService.get as jest.Mock).mockImplementation((key: string) => {
        const env: Record<string, string> = {
          SENDGRID_API_KEY: 'SG.test',
          OPENAI_API_KEY: 'sk-test',
          SLACK_BOT_TOKEN: 'xoxb-test',
        };
        return env[key];
      });

      const result = await appService.getIntegrationHealth();

      expect(result).toEqual({ sandbox: true, sendgrid: true, openai: true, slack: true });
    });

    it('should return false for each integration when env vars are absent', async () => {
      (sandboxService.isHealthy as jest.Mock).mockResolvedValue(false);
      (configService.get as jest.Mock).mockReturnValue(undefined);

      const result = await appService.getIntegrationHealth();

      expect(result).toEqual({ sandbox: false, sendgrid: false, openai: false, slack: false });
    });

    it('should not expose actual secret values — only boolean flags', async () => {
      (sandboxService.isHealthy as jest.Mock).mockResolvedValue(true);
      (configService.get as jest.Mock).mockReturnValue('super-secret-value');

      const result = await appService.getIntegrationHealth();

      expect(typeof result.sendgrid).toBe('boolean');
      expect(typeof result.openai).toBe('boolean');
      expect(typeof result.slack).toBe('boolean');
      expect(Object.values(result)).not.toContain('super-secret-value');
    });
  });
});
