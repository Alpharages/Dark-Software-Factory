import { Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { InAppNotificationService } from '../services/in-app-notification.service';
import { InAppNotificationResponseDto } from '../dto/in-app-notification-response.dto';
import { JwtAuthGuard } from '../../common/guards';
import { InAppNotificationRepository } from '../repositories/in-app-notification.repository';

@ApiTags('In-App Notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notifications/in-app')
export class InAppNotificationsController {
  constructor(
    private readonly inAppService: InAppNotificationService,
    private readonly repository: InAppNotificationRepository, // Using repo directly for list for now, or service wrapper
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get current user notifications' })
  @ApiResponse({ status: 200, type: [InAppNotificationResponseDto] })
  @ApiQuery({ name: 'unreadOnly', required: false, type: Boolean })
  @ApiQuery({ name: 'page', required: false, type: Number })
  async findAll(
    @Req() req: Request & { user: { id: string } },
    @Query('unreadOnly') unreadOnly?: string,
    @Query('page') page?: number,
  ) {
    const userId = req.user.id;
    const isUnread = unreadOnly === 'true';
    const pageNum = page || 1;
    return this.repository.findByUserId(userId, isUnread, pageNum);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Get count of unread notifications' })
  @ApiResponse({ status: 200, type: Number })
  async getUnreadCount(@Req() req: Request & { user: { id: string } }) {
    const userId = req.user.id;
    return this.inAppService.getUnreadCount(userId);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark notification as read' })
  @ApiResponse({ status: 200, type: InAppNotificationResponseDto })
  async markAsRead(@Req() req: Request & { user: { id: string } }, @Param('id') id: string) {
    const userId = req.user.id;
    return this.inAppService.markAsRead(id, userId);
  }

  @Post('read-all')
  @ApiOperation({ summary: 'Mark all notifications as read' })
  @ApiResponse({ status: 200 })
  async markAllAsRead(@Req() req: Request & { user: { id: string } }) {
    const userId = req.user.id;
    return { count: await this.inAppService.markAllAsRead(userId) };
  }
}
