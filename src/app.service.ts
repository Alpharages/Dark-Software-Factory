import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SandboxService } from './sandbox/sandbox.service';
import { IntegrationHealthResponseDto } from './common/dto';

@Injectable()
export class AppService {
  constructor(
    private readonly configService: ConfigService,
    private readonly sandboxService: SandboxService,
  ) {}

  getHello(): string {
    return 'Hello World!';
  }

  async getIntegrationHealth(): Promise<IntegrationHealthResponseDto> {
    let sandboxHealthy = false;
    try {
      sandboxHealthy = await this.sandboxService.isHealthy();
    } catch {
      sandboxHealthy = false;
    }

    return {
      sandbox: sandboxHealthy,
      sendgrid: !!this.configService.get('SENDGRID_API_KEY'),
      openai: !!this.configService.get('OPENAI_API_KEY'),
      slack: !!this.configService.get('SLACK_BOT_TOKEN'),
    };
  }
}
