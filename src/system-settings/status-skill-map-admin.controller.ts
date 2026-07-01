import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '@/common/guards/auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Roles } from '@/common/decorators/roles.decorator';
import { Role } from '@/auth/constants/roles.enum';
import { StatusSkillMapAdminService } from './status-skill-map-admin.service';
import { UpdateGlobalStatusSkillMapDto } from './dto/status-skill-map.dto';

@ApiTags('System Config')
@ApiBearerAuth()
@Controller('config/status-skill-map')
@UseGuards(JwtAuthGuard, RolesGuard, ThrottlerGuard)
export class StatusSkillMapAdminController {
  constructor(private readonly adminService: StatusSkillMapAdminService) {}

  @Get()
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Get the global default status→skill map' })
  @ApiResponse({
    status: 200,
    description: 'Global default map, loop terminals, and max iterations',
  })
  async getGlobalMap() {
    return this.adminService.getGlobalMap();
  }

  @Put()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Replace the global default status→skill map' })
  @ApiResponse({ status: 200, description: 'Updated map, effective immediately (no redeploy)' })
  async setGlobalMap(@Body() dto: UpdateGlobalStatusSkillMapDto, @Req() req: Request) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userId = (req as any).user?.id;
    return this.adminService.setGlobalMap(dto.entries, userId);
  }
}
