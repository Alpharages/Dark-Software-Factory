import { Controller, Get, UseGuards } from '@nestjs/common';
import { AppService } from './app.service';
import { PrismaService } from './database/prisma.service';
import { RabbitMQService } from './rabbitmq/rabbitmq.service';
import { Public, CurrentUser, Roles } from './common/decorators';
import { RolesGuard } from './common/guards';
import { AuthenticatedUser } from './auth/interfaces/jwt-payload.interface';
import { Role } from './auth/constants/roles.enum';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly prismaService: PrismaService,
    private readonly rabbitMQService: RabbitMQService,
  ) {}

  // Public route - no authentication required
  @Public()
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  // Public route - health check must be accessible for monitoring
  @Public()
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

  // Protected route - requires authentication
  @Get('profile')
  getProfile(@CurrentUser() user: AuthenticatedUser) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    };
  }

  // Protected route with role requirement
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN, Role.MANAGER)
  @Get('admin/stats')
  getAdminStats() {
    return {
      message: 'Admin only stats',
      timestamp: new Date().toISOString(),
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
