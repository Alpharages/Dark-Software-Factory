import { Controller, Get, Query, UseGuards, Req, Res, Logger, Param } from '@nestjs/common';
import { GitHubAuthFlowService } from './github-auth-flow.service';
import { JwtAuthGuard } from '../common/guards/auth.guard';
import { Response, Request } from 'express';

@Controller('api/v1/github')
export class GitHubAuthFlowController {
  private readonly logger = new Logger(GitHubAuthFlowController.name);

  constructor(private readonly authFlowService: GitHubAuthFlowService) {}

  @UseGuards(JwtAuthGuard)
  @Get('auth/login')
  getLoginUrl() {
    return { url: this.authFlowService.getOAuthUrl() };
  }

  @UseGuards(JwtAuthGuard)
  @Get('auth/callback')
  async handleCallback(
    @Req() req: Request & { user: { id: string } },
    @Res() res: Response,
    @Query('code') code?: string,
    @Query('error') errorQuery?: string,
    @Query('error_description') errorDescription?: string,
  ) {
    const userId = req.user.id;
    try {
      if (errorQuery) {
        // If GitHub redirected with an error (e.g., user denied access)
        const errorMessage = errorDescription || errorQuery;
        return res.redirect(
          `${process.env.FRONTEND_URL}/profile?error=${encodeURIComponent(
            errorMessage === 'access_denied' ? 'GitHub access request was declined.' : errorMessage,
          )}`,
        );
      }

      if (!code) {
        throw new Error('Authorization code is missing.');
      }

      await this.authFlowService.handleCallback(code, userId);
      // Redirect back to profile page
      return res.redirect(`${process.env.FRONTEND_URL}/profile?success=true`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return res.redirect(
        `${process.env.FRONTEND_URL}/profile?error=${encodeURIComponent(message)}`,
      );
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
