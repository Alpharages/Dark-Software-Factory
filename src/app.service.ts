import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DockerService } from './docker/docker.service';
import { IntegrationHealthResponseDto } from './common/dto';

@Injectable()
export class AppService {
  constructor(
    private readonly configService: ConfigService,
    private readonly dockerService: DockerService,
  ) {}

  getHello(): string {
    return 'Hello World!';
  }

  async getIntegrationHealth(): Promise<IntegrationHealthResponseDto> {
    let dockerHealthy = false;
    try {
      dockerHealthy = await this.dockerService.isHealthy();
    } catch {
      dockerHealthy = false;
    }

    return {
      docker: dockerHealthy,
      sendgrid: !!this.configService.get('SENDGRID_API_KEY'),
      openai: !!this.configService.get('OPENAI_API_KEY'),
      slack: !!this.configService.get('SLACK_BOT_TOKEN'),
    };
  }
}
