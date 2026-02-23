import { Controller, Get, Post, Body, UseGuards, Req, Logger, Param } from '@nestjs/common';
import { GitHubAuthFlowService } from './github-auth-flow.service';
import { JwtAuthGuard } from '@/common/guards';
import { Request } from 'express';

@Controller('github')
export class GitHubAuthFlowController {
  private readonly logger = new Logger(GitHubAuthFlowController.name);

  constructor(private readonly authFlowService: GitHubAuthFlowService) {}

  @UseGuards(JwtAuthGuard)
  @Get('auth/login')
  getLoginUrl() {
    return { url: this.authFlowService.getOAuthUrl() };
  }

  @UseGuards(JwtAuthGuard)
  @Post('auth/callback')
  async handleCallback(
    @Req() req: Request & { user: { id: string } },
    @Body() body: { code?: string; error?: string; error_description?: string },
  ) {
    const userId = req.user.id;
    const { code, error, error_description } = body;
    try {
      if (error) {
        // If GitHub redirected with an error (e.g., user denied access)
        const errorMessage = error_description || error;
        return {
          success: false,
          error:
            errorMessage === 'access_denied' ? 'GitHub access request was declined.' : errorMessage,
        };
      }

      if (!code) {
        throw new Error('Authorization code is missing.');
      }

      await this.authFlowService.handleCallback(code, userId);
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return { success: false, error: message };
    }
  }

  @UseGuards(JwtAuthGuard)
  @Get('accounts')
  async getAccounts(@Req() req: Request & { user: { id: string } }) {
    const userId = req.user.id;
    return this.authFlowService.getConnectedAccounts(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('accounts/:accountId/repos')
  async getRepos(
    @Param('accountId') accountId: string,
    @Req() req: Request & { user: { id: string } },
  ) {
    return this.authFlowService.getReposForAccount(accountId, req.user.id);
  }
}
