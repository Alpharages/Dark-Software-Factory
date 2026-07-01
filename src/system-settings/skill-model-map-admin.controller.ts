import { Body, Controller, Get, Param, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '@/common/guards/auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Roles } from '@/common/decorators/roles.decorator';
import { Role } from '@/auth/constants/roles.enum';
import { SkillModelMapAdminService } from './skill-model-map-admin.service';
import { UpdateSkillModelMapEntryDto } from './dto/skill-model-map.dto';

@ApiTags('System Config')
@ApiBearerAuth()
@Controller('admin/skill-model-map')
@UseGuards(JwtAuthGuard, RolesGuard, ThrottlerGuard)
export class SkillModelMapAdminController {
  constructor(private readonly adminService: SkillModelMapAdminService) {}

  @Get()
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'List the global skill→model map entries' })
  @ApiResponse({ status: 200, description: 'All skill→model map entries' })
  async list() {
    return this.adminService.listEntries();
  }

  @Put(':skill')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Update one skill→model map entry' })
  @ApiResponse({ status: 200, description: 'Updated entry, effective immediately (no redeploy)' })
  async update(
    @Param('skill') skill: string,
    @Body() dto: UpdateSkillModelMapEntryDto,
    @Req() req: Request,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userId = (req as any).user?.id;
    return this.adminService.updateEntry(skill, dto, userId);
  }
}
