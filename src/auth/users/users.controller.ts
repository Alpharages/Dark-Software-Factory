import {
  Controller,
  Get,
  Patch,
  Delete,
  Query,
  Param,
  Body,
  UseGuards,
  ParseUUIDPipe,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { UsersService } from './users.service';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserDto } from '../dto/user.dto';
import { UserDetailDto } from './dto/user-detail.dto';
import { PaginatedUsersResponseDto } from './dto/paginated-users-response.dto';
import { JwtAuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../constants/roles.enum';

interface AuthenticatedRequest {
  user: {
    id: string;
    email: string;
    role: string;
  };
}

@ApiTags('Auth - User Management')
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Roles(Role.ADMIN)
  @Throttle({ default: { limit: 100, ttl: 60000 } }) // 100 req/min
  @ApiOperation({ summary: 'List all users (ADMIN only)' })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of users',
    type: PaginatedUsersResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({
    status: 403,
    description: 'Insufficient permissions (ADMIN required)',
  })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  async listUsers(@Query() query: ListUsersQueryDto): Promise<PaginatedUsersResponseDto> {
    return this.usersService.listUsers(query);
  }

  @Get(':id')
  @Roles(Role.ADMIN)
  @Throttle({ default: { limit: 100, ttl: 60000 } }) // 100 req/min
  @ApiOperation({ summary: 'Get user details by ID (ADMIN only)' })
  @ApiParam({ name: 'id', description: 'User UUID' })
  @ApiResponse({
    status: 200,
    description: 'User details retrieved successfully',
    type: UserDetailDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid UUID format' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({
    status: 403,
    description: 'Insufficient permissions (ADMIN required)',
  })
  @ApiResponse({ status: 404, description: 'User not found' })
  async getUserById(@Param('id', ParseUUIDPipe) id: string): Promise<UserDetailDto> {
    return this.usersService.getUserById(id);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  @Throttle({ default: { limit: 100, ttl: 60000 } }) // 100 req/min
  @ApiOperation({ summary: 'Update user role or active status (ADMIN only)' })
  @ApiParam({ name: 'id', description: 'User UUID' })
  @ApiResponse({
    status: 200,
    description: 'User updated successfully',
    type: UserDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({
    status: 403,
    description: 'Cannot modify your own account',
  })
  @ApiResponse({ status: 404, description: 'User not found' })
  async updateUser(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<UserDto> {
    const adminUserId = req.user.id;
    return this.usersService.updateUser(id, dto, adminUserId);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @Throttle({ default: { limit: 100, ttl: 60000 } }) // 100 req/min
  @ApiOperation({ summary: 'Deactivate user (soft delete, ADMIN only)' })
  @ApiParam({ name: 'id', description: 'User UUID' })
  @ApiResponse({
    status: 200,
    description: 'User deactivated successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'User deactivated successfully' },
        userId: { type: 'string', example: '123e4567-e89b-12d3-a456-426614174000' },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({
    status: 403,
    description: 'Cannot deactivate your own account',
  })
  @ApiResponse({ status: 404, description: 'User not found' })
  async deactivateUser(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<{ message: string; userId: string }> {
    const adminUserId = req.user.id;
    return this.usersService.deactivateUser(id, adminUserId);
  }
}
