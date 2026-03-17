import {
  Controller,
  Get,
  Delete,
  Query,
  Param,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiParam,
  ApiResponse,
} from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { FastifyReply } from 'fastify';
import { ThrottlerGuard } from '@nestjs/throttler';
import { JwtAuthGuard } from '@/common/guards/auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { Public, CurrentUser } from '@/common/decorators';
import { Role } from '@/auth/constants/roles.enum';
import { AppProvider } from '@/prisma/enums';
import { ClickUpOAuthService } from '@/integrations/clickup-oauth.service';
import { ConnectedAppsService } from './connected-apps.service';
import { ConnectedAppResponseDto } from './dto/connected-app-response.dto';

@ApiTags('connected-apps')
@Controller('apps')
export class ConnectedAppsController {
  private readonly logger = new Logger(ConnectedAppsController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly oauthService: ClickUpOAuthService,
    private readonly appsService: ConnectedAppsService,
  ) {}

  @UseGuards(JwtAuthGuard, RolesGuard, ThrottlerGuard)
  @Roles(Role.PM, Role.MANAGER, Role.ADMIN)
  @Get('connected')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all connected apps for the current user' })
  @ApiResponse({
    status: 200,
    description: 'Returns list of connected apps',
    type: [ConnectedAppResponseDto],
  })
  async listConnectedApps(@CurrentUser('id') userId: string) {
    return this.appsService.findByUser(userId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard, ThrottlerGuard)
  @Roles(Role.PM, Role.MANAGER, Role.ADMIN)
  @Get('clickup/connect')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get ClickUp OAuth URL for user-level connection' })
  @ApiQuery({ name: 'returnTo', required: false, description: 'URL to return to after OAuth' })
  @ApiResponse({ status: 200, description: 'Returns { url }' })
  async getClickUpConnectUrl(
    @CurrentUser('id') userId: string,
    @Query('returnTo') returnTo?: string,
  ) {
    const url = await this.oauthService.getUserConnectUrl(userId, returnTo || 'settings');
    return { url };
  }

  @Public()
  @Get('clickup/callback')
  @ApiOperation({ summary: 'ClickUp OAuth callback for user-level connection' })
  @ApiQuery({ name: 'code', required: false })
  @ApiQuery({ name: 'state', required: false })
  async clickUpCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() reply: FastifyReply,
  ) {
    const frontendUrl = this.config.get<string>('FRONTEND_URL') ?? '';

    let decoded: { type: string; userId: string; returnTo: string };
    try {
      decoded = JSON.parse(Buffer.from(state ?? '', 'base64url').toString('utf-8'));
    } catch {
      return reply.redirect(
        `${frontendUrl}/settings/pm-callback?integration=error&returnTo=settings`,
        302,
      );
    }

    if (!decoded?.userId || decoded.type !== 'user') {
      return reply.redirect(
        `${frontendUrl}/settings/pm-callback?integration=error&returnTo=settings`,
        302,
      );
    }

    const returnTo = encodeURIComponent(decoded.returnTo ?? 'settings');

    try {
      if (!code) {
        throw new BadRequestException('No code provided from ClickUp');
      }

      const tokenData = await this.oauthService.exchangeCode(code);
      const identity = await this.oauthService.getBotIdentity(tokenData.access_token);

      const connectedApp = await this.appsService.upsert(
        decoded.userId,
        AppProvider.CLICKUP,
        identity.workspace_id,
        {
          workspace_id: identity.workspace_id,
          workspace_name: identity.workspace_name,
          access_token: tokenData.access_token,
          refresh_token: null,
          token_expiry: null,
          metadata: { botUserId: identity.bot_user_id, botUsername: identity.bot_username },
        },
      );

      return reply.redirect(
        `${frontendUrl}/settings/pm-callback?integration=connected&returnTo=${returnTo}&accountId=${connectedApp.id}`,
        302,
      );
    } catch (error) {
      this.logger.error('ClickUp user OAuth callback failed', {
        error: error instanceof Error ? error.message : error,
      });
      return reply.redirect(
        `${frontendUrl}/settings/pm-callback?integration=error&returnTo=${returnTo}`,
        302,
      );
    }
  }

  @UseGuards(JwtAuthGuard, RolesGuard, ThrottlerGuard)
  @Roles(Role.PM, Role.MANAGER, Role.ADMIN)
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Disconnect/Delete a connected app' })
  @ApiParam({ name: 'id', description: 'Connected App UUID' })
  @ApiResponse({ status: 200, description: 'App disconnected' })
  async disconnect(@CurrentUser('id') userId: string, @Param('id') id: string) {
    await this.appsService.delete(id, userId);
    return { message: 'Connected app disconnected successfully' };
  }

  @UseGuards(JwtAuthGuard, RolesGuard, ThrottlerGuard)
  @Roles(Role.PM, Role.MANAGER, Role.ADMIN)
  @Get(':id/hierarchy')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get ClickUp hierarchy for a connected app' })
  @ApiParam({ name: 'id', description: 'Connected App UUID' })
  @ApiQuery({ name: 'teamId', required: false, description: 'Optional ClickUp Team ID' })
  @ApiResponse({ status: 200, description: 'Returns ClickUp hierarchy' })
  async getHierarchy(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Query('teamId') teamId?: string,
  ) {
    const app = await this.appsService.getDecrypted(id, userId);
    if (!app.access_token) {
      throw new InternalServerErrorException('Connected app has no access token');
    }
    return this.oauthService.getHierarchyWithToken(app.access_token, teamId);
  }
}
