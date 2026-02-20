import { Controller, Get, Query, UseGuards, Req, Res, Logger } from '@nestjs/common';
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
    @Query('code') code: string,
    @Req() req: Request & { user: { id: string } },
    @Res() res: Response,
  ) {
    const userId = req.user.id;
    try {
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
}
