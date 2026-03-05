import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { LoginResponseDto } from './dto/login-response.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RefreshResponseDto } from './dto/refresh-response.dto';
import { LogoutDto } from './dto/logout.dto';
import { UserDto } from './dto/user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { JwtAuthGuard } from '../common/guards/auth.guard';
import { Public } from '../common/decorators/public.decorator';

/**
 * Authentication Controller
 * Story 17-3: Login & Session Management
 *
 * Provides endpoints for:
 * - User login
 * - Token refresh
 * - User logout
 * - Current user profile
 */
@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * POST /api/v1/auth/login
   * AC#1, AC#2, AC#3, AC#4, AC#5, AC#9
   */
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 900000 } }) // 5 attempts per 15 minutes
  @ApiOperation({
    summary: 'User login with email and password',
    description:
      'Authenticate user credentials and return JWT access token (24h) + refresh token (30d)',
  })
  @ApiResponse({
    status: 200,
    description: 'Login successful',
    type: LoginResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid input - missing or malformed email/password',
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid credentials - wrong email or password',
  })
  @ApiResponse({
    status: 403,
    description: 'Account deactivated - user account is disabled',
  })
  @ApiResponse({
    status: 429,
    description: 'Too many login attempts - rate limit exceeded',
  })
  async login(@Body() dto: LoginDto): Promise<LoginResponseDto> {
    return this.authService.login(dto);
  }

  /**
   * POST /api/v1/auth/refresh
   * AC#7
   */
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 900000 } }) // 20 attempts per 15 minutes
  @ApiOperation({
    summary: 'Refresh access token',
    description:
      'Exchange valid refresh token for new access token (24h expiry). Does not issue new refresh token.',
  })
  @ApiResponse({
    status: 200,
    description: 'New access token generated',
    type: RefreshResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid or revoked refresh token',
  })
  async refresh(@Body() dto: RefreshTokenDto): Promise<RefreshResponseDto> {
    return this.authService.refreshAccessToken(dto.refreshToken);
  }

  /**
   * POST /api/v1/auth/logout
   * AC#6
   */
  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Logout and revoke refresh token',
    description: 'Revoke refresh token to prevent future token refreshes (idempotent)',
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully logged out',
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid refresh token or not authenticated',
  })
  async logout(@Body() dto: LogoutDto): Promise<{ message: string }> {
    await this.authService.logout(dto.refreshToken);
    return { message: 'Successfully logged out' };
  }

  /**
   * GET /api/v1/auth/me
   * AC#8
   */
  @SkipThrottle()
  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get current authenticated user profile',
    description: 'Returns profile of currently logged-in user from JWT token',
  })
  @ApiResponse({
    status: 200,
    description: 'User profile retrieved',
    type: UserDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Not authenticated - missing or invalid access token',
  })
  async getCurrentUser(@Request() req: { user: { id: string } }): Promise<UserDto> {
    // req.user is populated by JwtAuthGuard with JWT payload
    return this.authService.getCurrentUser(req.user.id);
  }

  /**
   * POST /api/v1/auth/change-password
   * Story 17.10
   */
  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Change user password',
    description: 'Change the password for the authenticated user',
  })
  @ApiResponse({
    status: 200,
    description: 'Password changed successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid input',
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid current password',
  })
  async changePassword(
    @Request() req: { user: { id: string } },
    @Body() dto: ChangePasswordDto,
  ): Promise<{ message: string }> {
    if (dto.newPassword !== dto.confirmPassword) {
      throw new BadRequestException('New password and confirm password do not match');
    }
    await this.authService.changePassword(req.user.id, dto);
    return { message: 'Password changed successfully' };
  }
}
