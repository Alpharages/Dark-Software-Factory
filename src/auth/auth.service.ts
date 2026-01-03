import { Injectable, UnauthorizedException, ForbiddenException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../database/prisma.service';
import { LoginDto } from './dto/login.dto';
import { LoginResponseDto } from './dto/login-response.dto';
import { UserDto } from './dto/user.dto';
import { RefreshResponseDto } from './dto/refresh-response.dto';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';

/**
 * Authentication Service
 * Story 17-3: Login & Session Management
 *
 * Provides:
 * - User login with credential verification
 * - JWT token generation (access + refresh tokens)
 * - Token refresh mechanism
 * - Secure logout with token revocation
 * - Current user profile retrieval
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * Login user with email and password
   * AC#1, AC#2, AC#4, AC#5, AC#9
   *
   * Returns access token, refresh token, and user profile
   */
  async login(dto: LoginDto): Promise<LoginResponseDto> {
    // Step 1: Find user by email (case-insensitive)
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    // Step 2: Check if user exists (don't reveal if email is wrong)
    if (!user) {
      this.logger.warn(`Login failed: user not found for email ${dto.email}`);
      throw new UnauthorizedException('Invalid credentials');
    }

    // Step 3: Check if user is active
    if (!user.is_active) {
      this.logger.warn(`Login failed: account deactivated for user ${user.id}`);
      throw new ForbiddenException('Account deactivated');
    }

    // Step 4: Verify password using bcrypt
    const isPasswordValid = await bcrypt.compare(dto.password, user.password_hash);

    if (!isPasswordValid) {
      this.logger.warn(`Login failed: invalid password for email ${dto.email}`);
      throw new UnauthorizedException('Invalid credentials');
    }

    // Step 5: Generate access token (24h expiry)
    const accessToken = this.jwtService.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
      type: 'access',
    });

    // Step 6: Generate refresh token with unique ID (30-day expiry)
    const tokenId = randomUUID();
    const refreshToken = this.jwtService.sign(
      {
        sub: user.id,
        type: 'refresh',
        jti: tokenId,
      },
      { expiresIn: '30d' },
    );

    // Step 7: Store refresh token and update last login in atomic transaction
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    await this.prisma.$transaction([
      this.prisma.refreshToken.create({
        data: {
          token_id: tokenId,
          user_id: user.id,
          expires_at: expiresAt,
        },
      }),
      this.prisma.user.update({
        where: { id: user.id },
        data: { last_login_at: new Date() },
      }),
    ]);

    this.logger.log(`User logged in successfully: ${user.id}`);

    // Step 8: Return tokens and user profile (exclude password_hash)
    return {
      accessToken,
      refreshToken,
      user: this.mapToUserDto(user),
    };
  }

  /**
   * Refresh access token using refresh token
   * AC#7
   *
   * Validates refresh token and generates new access token
   */
  async refreshAccessToken(refreshToken: string): Promise<RefreshResponseDto> {
    try {
      // Step 1: Verify refresh token JWT signature and expiration
      const payload = await this.jwtService.verifyAsync(refreshToken);

      // Step 2: Validate token type claim
      if (payload.type !== 'refresh') {
        this.logger.warn('Token refresh failed: invalid token type');
        throw new UnauthorizedException('Invalid token type');
      }

      // Step 3: Check token not revoked in database
      const tokenRecord = await this.prisma.refreshToken.findUnique({
        where: { token_id: payload.jti },
      });

      if (!tokenRecord || tokenRecord.is_revoked) {
        this.logger.warn(`Token refresh failed: token not found or revoked ${payload.jti}`);
        throw new UnauthorizedException('Token has been revoked');
      }

      // Check if token is expired in database (robustness check)
      if (tokenRecord.expires_at < new Date()) {
        this.logger.warn(`Token refresh failed: token expired in DB ${payload.jti}`);
        throw new UnauthorizedException('Refresh token expired');
      }

      // Step 4: Generate new access token
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
      });

      if (!user) {
        this.logger.warn(`Token refresh failed: user not found ${payload.sub}`);
        throw new UnauthorizedException('User not found');
      }

      const accessToken = this.jwtService.sign({
        sub: user.id,
        email: user.email,
        role: user.role,
        type: 'access',
      });

      this.logger.log(`Access token refreshed for user: ${user.id}`);

      // Step 5: Return new access token
      return { accessToken };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Token refresh failed: ${errorMessage}`);
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  /**
   * Logout user by revoking refresh token
   * AC#6
   *
   * Marks refresh token as revoked (idempotent)
   */
  async logout(refreshToken: string): Promise<void> {
    try {
      // Step 1: Verify refresh token
      const payload = await this.jwtService.verifyAsync(refreshToken);

      // Step 2: Mark token as revoked
      await this.prisma.refreshToken.update({
        where: { token_id: payload.jti },
        data: { is_revoked: true },
      });

      this.logger.log(`User logged out successfully: ${payload.sub}`);
    } catch (error) {
      // Idempotent: return success even if token already revoked or not found
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.log(`Logout attempted with invalid token: ${errorMessage}`);
      // Don't throw - logout should be idempotent
    }
  }

  /**
   * Get current authenticated user profile
   * AC#8
   *
   * Returns user profile based on user ID from JWT
   */
  async getCurrentUser(userId: string): Promise<UserDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      this.logger.warn(`Get current user failed: user not found ${userId}`);
      throw new UnauthorizedException('User not found');
    }

    return this.mapToUserDto(user);
  }

  /**
   * Helper: Map Prisma User to UserDto (exclude password_hash)
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mapToUserDto(user: any): UserDto {
    return {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      role: user.role,
      isActive: user.is_active,
    };
  }

  /**
   * Change user password
   * Story 17.10
   */
  async changePassword(
    userId: string,
    dto: { currentPassword: string; newPassword: string },
  ): Promise<void> {
    // 1. Get user with password hash
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      this.logger.warn(`Change password failed: user not found ${userId}`);
      throw new UnauthorizedException('User not found');
    }

    // 2. Verify current password
    const isPasswordValid = await bcrypt.compare(dto.currentPassword, user.password_hash);
    if (!isPasswordValid) {
      this.logger.warn(`Change password failed: invalid current password for user ${userId}`);
      throw new UnauthorizedException('Invalid current password');
    }

    // 3. Hash new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(dto.newPassword, salt);

    // 4. Update user password
    await this.prisma.user.update({
      where: { id: userId },
      data: { password_hash: hashedPassword },
    });

    this.logger.log(`Password changed successfully for user: ${userId}`);
  }
}
