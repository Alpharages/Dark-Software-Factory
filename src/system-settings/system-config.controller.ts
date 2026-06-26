import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  UseGuards,
  Req,
  Logger,
  Delete,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/common/guards/auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Roles } from '@/common/decorators/roles.decorator';
import { Role } from '@/auth/constants/roles.enum';
import { SystemConfigService } from './system-config.service';
import { CreateSystemConfigDto, UpdateSystemConfigDto } from './dto/system-config.dto';
import { Request } from 'express';

@ApiTags('System Config')
@ApiBearerAuth()
@Controller('config')
@UseGuards(JwtAuthGuard, RolesGuard, ThrottlerGuard)
export class SystemConfigController {
  private readonly logger = new Logger(SystemConfigController.name);

  constructor(private readonly systemConfigService: SystemConfigService) {}

  @Get()
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Get all system configurations' })
  @ApiResponse({ status: 200, description: 'Return all configurations' })
  async getAllConfig() {
    return this.systemConfigService.getAll();
  }

  @Post()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Create or update a system configuration' })
  @ApiResponse({ status: 201, description: 'Configuration created/updated' })
  async createConfig(@Body() createConfigDto: CreateSystemConfigDto, @Req() req: Request) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userId = (req as any).user?.id;
    return this.systemConfigService.set(
      createConfigDto.key,
      createConfigDto.value,
      createConfigDto.description,
      createConfigDto.is_secret,
      userId,
    );
  }

  @Patch(':key')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Update a specific system configuration' })
  @ApiResponse({ status: 200, description: 'Configuration updated' })
  async updateConfig(
    @Param('key') key: string,
    @Body() updateConfigDto: UpdateSystemConfigDto,
    @Req() req: Request,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userId = (req as any).user?.id;
    return this.systemConfigService.set(
      key,
      updateConfigDto.value,
      updateConfigDto.description,
      updateConfigDto.is_secret,
      userId,
    );
  }

  @Post('reset')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Reset configurations to defaults' })
  @ApiResponse({ status: 200, description: 'Configurations reset' })
  async resetConfigPost(@Body() body: { keys?: string[] }, @Req() req: Request) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userId = (req as any).user?.id;
    if (body.keys && body.keys.length > 0) {
      await Promise.all(body.keys.map((key) => this.systemConfigService.reset(key, userId)));
      return { success: true, message: `Configurations ${body.keys.join(', ')} reset to defaults` };
    } else {
      await this.systemConfigService.resetAll(userId);
      return { success: true, message: 'All configurations reset to defaults' };
    }
  }

  @Delete(':key')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Reset a configuration to default (delete from DB)' })
  @ApiResponse({ status: 200, description: 'Configuration reset' })
  async resetConfig(@Param('key') key: string, @Req() req: Request) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userId = (req as any).user?.id;
    await this.systemConfigService.reset(key, userId);
    return { success: true, message: `Configuration ${key} reset to defaults (env)` };
  }
}
