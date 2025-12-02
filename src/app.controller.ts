import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
} from '@nestjs/swagger';
import { AppService } from './app.service';
import { PrismaService } from './database/prisma.service';
import { RabbitMQService } from './rabbitmq/rabbitmq.service';
import { Public, CurrentUser, Roles } from './common/decorators';
import { RolesGuard } from './common/guards';
import { AuthenticatedUser } from './auth/interfaces/jwt-payload.interface';
import { Role } from './auth/constants/roles.enum';
import {
  HealthResponseDto,
  ProfileResponseDto,
  AdminStatsResponseDto,
  UnauthorizedResponseDto,
  ForbiddenResponseDto,
} from './common/dto';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly prismaService: PrismaService,
    private readonly rabbitMQService: RabbitMQService,
  ) { }

  @ApiTags('Health')
  @ApiOperation({ summary: 'Root endpoint' })
  @ApiResponse({ status: 200, schema: { type: 'string', example: 'Hello World!' } })
  @Public()
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @ApiTags('Health')
  @ApiOperation({ summary: 'Health check', description: 'Returns health status of database and RabbitMQ' })
  @ApiResponse({ status: 200, type: HealthResponseDto })
  @Public()
  @Get('health')
  async getHealth(): Promise<HealthResponseDto> {
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

  @ApiTags('Auth')
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiBearerAuth('JWT-auth')
  @ApiResponse({ status: 200, type: ProfileResponseDto })
  @ApiUnauthorizedResponse({ type: UnauthorizedResponseDto })
  @Get('profile')
  getProfile(@CurrentUser() user: AuthenticatedUser): ProfileResponseDto {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    };
  }

  @ApiTags('Admin')
  @ApiOperation({ summary: 'Get admin statistics', description: 'Requires ADMIN or MANAGER role' })
  @ApiBearerAuth('JWT-auth')
  @ApiResponse({ status: 200, type: AdminStatsResponseDto })
  @ApiUnauthorizedResponse({ type: UnauthorizedResponseDto })
  @ApiForbiddenResponse({ type: ForbiddenResponseDto })
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN, Role.MANAGER)
  @Get('admin/stats')
  getAdminStats(): AdminStatsResponseDto {
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
