import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { PrismaService } from './database/prisma.service';
import { RabbitMQService } from './rabbitmq/rabbitmq.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly prismaService: PrismaService,
    private readonly rabbitMQService: RabbitMQService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  async getHealth() {
    const dbHealthy = await this.checkDatabaseHealth();
    // In test/dev without docker, this might fail, so we handle it gracefully or let it report down
    let rabbitMQHealthy = false;
    try {
      rabbitMQHealthy = await this.rabbitMQService.isHealthy();
    } catch {
      rabbitMQHealthy = false;
    }

    const isHealthy = dbHealthy && rabbitMQHealthy;

    return {
      status: isHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      services: {
        database: dbHealthy ? 'up' : 'down',
        rabbitmq: rabbitMQHealthy ? 'up' : 'down',
      },
    };
  }

  private async checkDatabaseHealth(): Promise<boolean> {
    try {
      await this.prismaService.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
