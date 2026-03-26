import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Delete,
  UseGuards,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags, ApiResponse } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { JwtAuthGuard, RolesGuard } from '../common/guards';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../auth/constants/roles.enum';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '@prisma/client';
import { AiRoutingConfigService } from './ai-routing-config.service';
import { UpdateAiRoutingConfigDto, EffectiveAiRoutingConfigDto } from './dto/ai-routing-config.dto';
import { PrismaService } from '@/database/prisma.service';

@ApiTags('AI Routing Configuration')
@Controller('ai-routing/config')
@UseGuards(JwtAuthGuard, RolesGuard, ThrottlerGuard)
@ApiBearerAuth()
export class AiRoutingConfigController {
  constructor(
    private readonly configService: AiRoutingConfigService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('global')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Get effective global AI routing configuration' })
  @ApiResponse({ type: EffectiveAiRoutingConfigDto })
  async getGlobalConfig() {
    return this.configService.getEffectiveConfig();
  }

  @Patch('global')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Update global AI routing defaults (ADMIN only)' })
  @ApiResponse({ type: EffectiveAiRoutingConfigDto })
  async updateGlobalConfig(@Body() dto: UpdateAiRoutingConfigDto, @CurrentUser() user: User) {
    return this.configService.upsertGlobalConfig(user.id, dto);
  }

  @Get('project/:projectId')
  @Roles(Role.ADMIN, Role.MANAGER, Role.PM)
  @ApiOperation({ summary: 'Get raw project-level config override row' })
  async getProjectConfig(@Param('projectId') projectId: string, @CurrentUser() user: User) {
    await this.checkProjectOwnership(projectId, user);
    return this.configService.getEffectiveConfig(projectId);
  }

  @Get('project/:projectId/effective')
  @Roles(Role.ADMIN, Role.MANAGER, Role.PM)
  @ApiOperation({
    summary: 'Get merged effective config for a project (global + project overrides)',
  })
  @ApiResponse({ type: EffectiveAiRoutingConfigDto })
  async getEffectiveProjectConfig(
    @Param('projectId') projectId: string,
    @CurrentUser() user: User,
  ) {
    await this.checkProjectOwnership(projectId, user);
    return this.configService.getEffectiveConfig(projectId);
  }

  @Patch('project/:projectId')
  @Roles(Role.ADMIN, Role.MANAGER, Role.PM)
  @ApiOperation({ summary: 'Set project AI routing override' })
  async updateProjectConfig(
    @Param('projectId') projectId: string,
    @Body() dto: UpdateAiRoutingConfigDto,
    @CurrentUser() user: User,
  ) {
    await this.checkProjectOwnership(projectId, user);
    return this.configService.upsertProjectConfig(projectId, user.id, dto);
  }

  @Delete('project/:projectId')
  @Roles(Role.ADMIN, Role.MANAGER, Role.PM)
  @ApiOperation({ summary: 'Remove project AI routing override (reverts to global defaults)' })
  async deleteProjectConfig(@Param('projectId') projectId: string, @CurrentUser() user: User) {
    await this.checkProjectOwnership(projectId, user);
    return this.configService.deleteProjectConfig(projectId);
  }

  /**
   * Admins and Managers have global access.
   * PMs must own the project (pm_id matches their user id).
   */
  private async checkProjectOwnership(projectId: string, user: User) {
    if (user.role === Role.ADMIN || user.role === Role.MANAGER) return;

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { pm_id: true },
    });

    if (!project) throw new NotFoundException(`Project ${projectId} not found`);

    if (project.pm_id !== user.id) {
      throw new ForbiddenException(
        'You do not have permission to modify this project configuration',
      );
    }
  }
}
