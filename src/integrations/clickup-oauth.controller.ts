import {
  Controller,
  Get,
  Delete,
  Query,
  Res,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { FastifyReply } from 'fastify';
import { ThrottlerGuard } from '@nestjs/throttler';
import { JwtAuthGuard } from '@/common/guards/auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { Public } from '@/common/decorators';
import { Role } from '@/auth/constants/roles.enum';
import { PMProvider } from '@prisma/client';
import { ClickUpOAuthService } from './clickup-oauth.service';
import { ProjectIntegrationService } from './project-integration.service';

@ApiTags('Integrations')
@Controller('integrations/clickup')
export class ClickUpOAuthController {
  constructor(
    private readonly oauthService: ClickUpOAuthService,
    private readonly integrationService: ProjectIntegrationService,
  ) {}

  @UseGuards(JwtAuthGuard, RolesGuard, ThrottlerGuard)
  @Roles(Role.PM, Role.MANAGER, Role.ADMIN)
  @Get('connect')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get ClickUp OAuth authorization URL for a project' })
  @ApiQuery({ name: 'project_id', required: true, description: 'Project UUID' })
  @ApiResponse({ status: 200, description: 'Returns { url } to redirect the user to ClickUp' })
  @ApiResponse({ status: 400, description: 'OAuth credentials not configured' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  async connect(@Query('project_id') projectId: string) {
    return { url: await this.oauthService.getConnectUrl(projectId) };
  }

  @Public()
  @Get('callback')
  @ApiOperation({ summary: 'ClickUp OAuth callback — browser redirect from ClickUp' })
  @ApiQuery({ name: 'code', required: false })
  @ApiQuery({ name: 'state', required: false })
  @ApiResponse({ status: 302, description: 'Redirects to frontend project settings' })
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const redirectUrl = await this.oauthService.handleCallback(code ?? '', state ?? '');
    return reply.redirect(redirectUrl, 302);
  }

  @UseGuards(JwtAuthGuard, RolesGuard, ThrottlerGuard)
  @Roles(Role.PM, Role.MANAGER, Role.ADMIN)
  @Delete()
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Disconnect ClickUp integration from a project' })
  @ApiQuery({ name: 'project_id', required: true, description: 'Project UUID' })
  @ApiResponse({ status: 200, description: 'Integration disconnected' })
  @ApiResponse({ status: 404, description: 'Integration not found' })
  async disconnect(@Query('project_id') projectId: string) {
    await this.integrationService.deleteIntegration(projectId, PMProvider.CLICKUP);
    return { message: 'ClickUp integration disconnected successfully' };
  }
}
