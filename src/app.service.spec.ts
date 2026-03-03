import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AppService } from './app.service';
import { DockerService } from './docker/docker.service';

describe('AppService', () => {
  let appService: AppService;
  let configService: jest.Mocked<ConfigService>;
  let dockerService: jest.Mocked<Partial<DockerService>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppService,
        {
          provide: ConfigService,
          useValue: { get: jest.fn() },
        },
        {
          provide: DockerService,
          useValue: { isHealthy: jest.fn() },
        },
      ],
    }).compile();

    appService = module.get<AppService>(AppService);
    configService = module.get(ConfigService);
    dockerService = module.get(DockerService);
  });

  describe('getHello', () => {
    it('should return "Hello World!"', () => {
      expect(appService.getHello()).toBe('Hello World!');
    });
  });

  describe('getIntegrationHealth', () => {
    it('should return true for docker when DockerService reports healthy', async () => {
      (dockerService.isHealthy as jest.Mock).mockResolvedValue(true);
      (configService.get as jest.Mock).mockReturnValue(undefined);

      const result = await appService.getIntegrationHealth();

      expect(result.docker).toBe(true);
    });

    it('should return false for docker when DockerService reports unhealthy', async () => {
      (dockerService.isHealthy as jest.Mock).mockResolvedValue(false);
      (configService.get as jest.Mock).mockReturnValue(undefined);

      const result = await appService.getIntegrationHealth();

      expect(result.docker).toBe(false);
    });

    it('should return false for docker when DockerService throws (socket unavailable)', async () => {
      (dockerService.isHealthy as jest.Mock).mockRejectedValue(
        new Error('connect ENOENT /var/run/docker.sock'),
      );
      (configService.get as jest.Mock).mockReturnValue(undefined);

      const result = await appService.getIntegrationHealth();

      expect(result.docker).toBe(false);
    });

    it('should return true for each integration when env vars are present', async () => {
      (dockerService.isHealthy as jest.Mock).mockResolvedValue(true);
      (configService.get as jest.Mock).mockImplementation((key: string) => {
        const env: Record<string, string> = {
          SENDGRID_API_KEY: 'SG.test',
          OPENAI_API_KEY: 'sk-test',
          SLACK_BOT_TOKEN: 'xoxb-test',
        };
        return env[key];
      });

      const result = await appService.getIntegrationHealth();

      expect(result).toEqual({ docker: true, sendgrid: true, openai: true, slack: true });
    });

    it('should return false for each integration when env vars are absent', async () => {
      (dockerService.isHealthy as jest.Mock).mockResolvedValue(false);
      (configService.get as jest.Mock).mockReturnValue(undefined);

      const result = await appService.getIntegrationHealth();

      expect(result).toEqual({ docker: false, sendgrid: false, openai: false, slack: false });
    });

    it('should not expose actual secret values — only boolean flags', async () => {
      (dockerService.isHealthy as jest.Mock).mockResolvedValue(true);
      (configService.get as jest.Mock).mockReturnValue('super-secret-value');

      const result = await appService.getIntegrationHealth();

      expect(typeof result.sendgrid).toBe('boolean');
      expect(typeof result.openai).toBe('boolean');
      expect(typeof result.slack).toBe('boolean');
      expect(Object.values(result)).not.toContain('super-secret-value');
    });
  });
});
