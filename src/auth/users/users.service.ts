import { Injectable, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserDto } from '../dto/user.dto';
import { UserDetailDto } from './dto/user-detail.dto';
import { PaginatedUsersResponseDto } from './dto/paginated-users-response.dto';
import { PaginationMetaDto } from './dto/pagination-meta.dto';
import { Role } from '../constants/roles.enum';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * List all users with pagination and filtering
   * AC#1: Returns paginated list of users with role/status/search filters
   */
  async listUsers(query: ListUsersQueryDto): Promise<PaginatedUsersResponseDto> {
    const { page = 1, limit = 20, role, isActive, search } = query;

    // Build dynamic where clause
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {};

    if (role !== undefined) {
      where.role = role;
    }

    if (isActive !== undefined) {
      where.is_active = isActive;
    }

    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { full_name: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Calculate pagination
    const skip = (page - 1) * limit;
    const take = limit;

    // Execute queries in parallel
    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take,
        orderBy: { created_at: 'desc' },
        select: {
          id: true,
          email: true,
          full_name: true,
          role: true,
          is_active: true,
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    // Calculate pagination metadata
    const totalPages = Math.ceil(total / limit);
    const hasNext = page < totalPages;
    const hasPrevious = page > 1;

    const pagination: PaginationMetaDto = {
      page,
      limit,
      total,
      totalPages,
      hasNext,
      hasPrevious,
    };

    // Map to UserDto
    const userDtos: UserDto[] = users.map((user) => ({
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      role: user.role as Role,
      isActive: user.is_active,
    }));

    return {
      users: userDtos,
      pagination,
    };
  }

  /**
   * Get detailed user information by ID
   * AC#2: Returns user details with invitation and token counts
   */
  async getUserById(userId: string): Promise<UserDetailDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        full_name: true,
        role: true,
        is_active: true,
        last_login_at: true,
        created_at: true,
      },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    // Get counts in parallel
    const [invitationsSentCount, activeRefreshTokensCount] = await Promise.all([
      this.prisma.userInvitation.count({
        where: { invited_by_id: userId },
      }),
      this.prisma.refreshToken.count({
        where: {
          user_id: userId,
          is_revoked: false,
          expires_at: { gt: new Date() },
        },
      }),
    ]);

    const userDetail: UserDetailDto = {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      role: user.role as Role,
      isActive: user.is_active,
      lastLoginAt: user.last_login_at,
      createdAt: user.created_at,
      invitationsSentCount,
      activeRefreshTokensCount,
    };

    return userDetail;
  }

  /**
   * Update user role or active status
   * AC#3: Partial update with self-modification check
   */
  async updateUser(userId: string, dto: UpdateUserDto, adminUserId: string): Promise<UserDto> {
    // AC#6: Prevent self-modification
    if (userId === adminUserId) {
      throw new ForbiddenException(
        'Cannot modify your own account through this endpoint. Use /auth/me for profile updates.',
      );
    }

    // Fetch existing user
    const existingUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        full_name: true,
        role: true,
        is_active: true,
      },
    });

    if (!existingUser) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    // Build changes object for audit log
    const changes: Record<string, { before: string | boolean; after: string | boolean }> = {};
    if (dto.role !== undefined && dto.role !== existingUser.role) {
      changes.role = { before: existingUser.role, after: dto.role };
    }
    if (dto.isActive !== undefined && dto.isActive !== existingUser.is_active) {
      changes.isActive = { before: existingUser.is_active, after: dto.isActive };
    }

    // Update user
    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.role !== undefined && { role: dto.role }),
        ...(dto.isActive !== undefined && { is_active: dto.isActive }),
      },
      select: {
        id: true,
        email: true,
        full_name: true,
        role: true,
        is_active: true,
      },
    });

    // AC#5: Audit logging
    if (Object.keys(changes).length > 0) {
      const admin = await this.prisma.user.findUnique({
        where: { id: adminUserId },
        select: { email: true },
      });

      const changesStr = Object.entries(changes)
        .map(([key, value]) => `${key}: ${value.before} → ${value.after}`)
        .join(', ');

      this.logger.log(
        `[AUDIT] Admin ${admin?.email || adminUserId} updated user ${updatedUser.email} - Changes: { ${changesStr} }`,
        UsersService.name,
      );
    }

    return {
      id: updatedUser.id,
      email: updatedUser.email,
      fullName: updatedUser.full_name,
      role: updatedUser.role as Role,
      isActive: updatedUser.is_active,
    };
  }

  /**
   * Deactivate user (soft delete)
   * AC#4: Sets is_active=false and revokes refresh tokens
   */
  async deactivateUser(
    userId: string,
    adminUserId: string,
  ): Promise<{ message: string; userId: string }> {
    // AC#6: Prevent self-deactivation
    if (userId === adminUserId) {
      throw new ForbiddenException('Cannot deactivate your own account');
    }

    // Fetch user
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, is_active: true },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    // Atomic transaction: deactivate user + revoke tokens
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { is_active: false },
      }),
      this.prisma.refreshToken.updateMany({
        where: {
          user_id: userId,
          is_revoked: false,
        },
        data: { is_revoked: true },
      }),
    ]);

    // AC#5: Audit logging
    const admin = await this.prisma.user.findUnique({
      where: { id: adminUserId },
      select: { email: true },
    });

    this.logger.log(
      `[AUDIT] Admin ${admin?.email || adminUserId} deactivated user ${user.email}`,
      UsersService.name,
    );

    return {
      message: 'User deactivated successfully',
      userId,
    };
  }
}
