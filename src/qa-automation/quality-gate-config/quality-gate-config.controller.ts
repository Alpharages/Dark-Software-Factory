import { Body, Controller, Get, Post, Param, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../auth/constants/roles.enum';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from '@/prisma/client';

import { QualityGateConfigService } from './quality-gate-config.service';
import { UpdateQualityGateConfigDto } from './dto/update-quality-gate-config.dto';
import { CloneConfigDto } from './dto/clone-config.dto';
import { ConfigPreviewRequestDto } from './dto/config-preview.dto';

@ApiTags('Quality Gate Configuration')
@Controller('quality-gates/config')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class QualityGateConfigController {
  constructor(private readonly configService: QualityGateConfigService) {}

  @Get('defaults')
  @ApiOperation({ summary: 'Get global default configuration' })
  async getGlobalConfig() {
    return this.configService.getEffectiveConfig(undefined);
  }

  @Put('defaults')
  @ApiOperation({ summary: 'Update global default configuration' })
  @Roles(Role.ADMIN, Role.QA)
  async updateGlobalConfig(@Body() dto: UpdateQualityGateConfigDto, @CurrentUser() user: User) {
    return this.configService.updateGlobalConfig(dto, user.id);
  }

  @Get(':projectId')
  @ApiOperation({ summary: 'Get project specific configuration' })
  async getProjectConfig(@Param('projectId') projectId: string) {
    return this.configService.getEffectiveConfig(projectId);
  }

  @Put(':projectId')
  @ApiOperation({ summary: 'Update project configuration' })
  @Roles(Role.ADMIN, Role.QA)
  async updateProjectConfig(
    @Param('projectId') projectId: string,
    @Body() dto: UpdateQualityGateConfigDto,
    @CurrentUser() user: User,
  ) {
    return this.configService.updateProjectConfig(projectId, dto, user.id);
  }

  @Get(':projectId/history')
  @ApiOperation({ summary: 'Get configuration history' })
  async getHistory(@Param('projectId') projectId: string, @Query('limit') limit?: number) {
    return this.configService.getConfigHistory(projectId, limit);
  }

  @Post('preview')
  @ApiOperation({ summary: 'Preview configuration impact' })
  async previewImpact(@Body() dto: ConfigPreviewRequestDto) {
    return this.configService.previewConfigImpact(dto.projectId, dto.configuration);
  }

  @Post(':projectId/clone')
  @ApiOperation({ summary: 'Clone configuration to other projects' })
  @Roles(Role.ADMIN, Role.QA)
  async cloneConfig(
    @Param('projectId') projectId: string,
    @Body() dto: CloneConfigDto,
    @CurrentUser() user: User,
  ) {
    return this.configService.cloneConfig(projectId, dto.targetProjectIds, user.id);
  }
}
