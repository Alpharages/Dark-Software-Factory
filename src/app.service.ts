import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IntegrationHealthResponseDto } from './common/dto';

@Injectable()
export class AppService {
  constructor(private readonly configService: ConfigService) {}

  getHello(): string {
    return 'Hello World!';
  }

  async getIntegrationHealth(): Promise<IntegrationHealthResponseDto> {
    return {
      sendgrid: !!this.configService.get('SENDGRID_API_KEY'),
      openai: !!this.configService.get('OPENAI_API_KEY'),
      slack: !!this.configService.get('SLACK_BOT_TOKEN'),
    };
  }
}
