import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Query,
  Param,
  UseGuards,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { InvitationsService } from './invitations.service';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { ListInvitationsQueryDto } from './dto/list-invitations-query.dto';
import { InvitationResponseDto } from './dto/invitation-response.dto';
import { VerifyTokenResponseDto } from './dto/verify-token-response.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../constants/roles.enum';
import { JwtAuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser as User } from '../../common/decorators/current-user.decorator';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('Invitations')
@Controller('auth/invitations')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  @Post()
  @Roles(Role.ADMIN, Role.MANAGER)
  @Throttle({ default: { limit: 20, ttl: 3600000 } }) // 20 per hour
  @ApiOperation({ summary: 'Create a new user invitation' })
  @ApiResponse({
    status: 201,
    description: 'Invitation created successfully',
    type: InvitationResponseDto,
  })
  @ApiResponse({ status: 409, description: 'Invitation already exists' })
  async create(
    @User('id') userId: string,
    @Body() createInvitationDto: CreateInvitationDto,
  ): Promise<InvitationResponseDto> {
    const invitation = await this.invitationsService.createInvitation(userId, createInvitationDto);
    return {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      inviteToken: invitation.invite_token,
      invitedBy: {
        id: invitation.invited_by.id,
        email: invitation.invited_by.email,
        fullName: invitation.invited_by.full_name,
      },
      expiresAt: invitation.expires_at,
      createdAt: invitation.created_at,
    };
  }

  @Get()
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'List invitations with filtering' })
  @ApiResponse({
    status: 200,
    description: 'List of invitations',
    type: [InvitationResponseDto],
  })
  async findAll(@Query() query: ListInvitationsQueryDto) {
    const result = await this.invitationsService.listInvitations(query);
    return {
      ...result,
      items: result.items.map((invitation) => ({
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        status: invitation.status,
        inviteToken: invitation.invite_token,
        invitedBy: {
          id: invitation.invited_by.id,
          email: invitation.invited_by.email,
          fullName: invitation.invited_by.full_name,
        },
        expiresAt: invitation.expires_at,
        createdAt: invitation.created_at,
      })),
    };
  }

  @Delete(':id')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Revoke an invitation' })
  @ApiParam({ name: 'id', description: 'Invitation ID' })
  @ApiResponse({
    status: 200,
    description: 'Invitation revoked successfully',
  })
  async remove(@Param('id') id: string) {
    return this.invitationsService.revokeInvitation(id);
  }

  @Get('verify/:token')
  @Public()
  @SkipThrottle() // Don't rate limit verification too strictly, or use a separate strategy
  @ApiOperation({ summary: 'Verify invitation token' })
  @ApiParam({ name: 'token', description: 'Invitation token' })
  @ApiResponse({
    status: 200,
    description: 'Token is valid',
    type: VerifyTokenResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Token not found' })
  @ApiResponse({ status: 410, description: 'Token expired' })
  async verify(@Param('token') token: string): Promise<VerifyTokenResponseDto> {
    try {
      return await this.invitationsService.verifyToken(token);
    } catch (error: unknown) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException('Invalid token', HttpStatus.NOT_FOUND);
    }
  }
}
