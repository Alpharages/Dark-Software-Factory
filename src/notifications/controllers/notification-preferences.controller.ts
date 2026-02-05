import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { NotificationPreferenceRepository } from '../repositories/notification-preference.repository';
import { CreateNotificationPreferenceDto } from '../dto/create-notification-preference.dto';
import { UpdateNotificationPreferenceDto } from '../dto/update-notification-preference.dto';
import { NotificationPreferenceResponseDto } from '../dto/notification-preference-response.dto';
import { JwtAuthGuard } from '../../common/guards';

@ApiTags('Notification Preferences')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notifications/preferences')
export class NotificationPreferencesController {
  constructor(private readonly repository: NotificationPreferenceRepository) {}

  @Get()
  @ApiOperation({ summary: 'Get all preferences for current user' })
  @ApiResponse({ status: 200, type: [NotificationPreferenceResponseDto] })
  async findAll(@Req() req: Request & { user: { id: string } }) {
    const userId = req.user.id;
    return this.repository.findByUserId(userId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new preference' })
  @ApiResponse({ status: 201, type: NotificationPreferenceResponseDto })
  async create(
    @Req() req: Request & { user: { id: string } },
    @Body() dto: CreateNotificationPreferenceDto,
  ) {
    const userId = req.user.id;
    return this.repository.create(userId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a preference' })
  @ApiResponse({ status: 200, type: NotificationPreferenceResponseDto })
  async update(
    @Req() req: Request & { user: { id: string } },
    @Param('id') id: string,
    @Body() dto: UpdateNotificationPreferenceDto,
  ) {
    const userId = req.user.id;
    return this.repository.update(id, userId, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a preference' })
  @ApiResponse({ status: 200 })
  async delete(@Req() req: Request & { user: { id: string } }, @Param('id') id: string) {
    const userId = req.user.id;
    return this.repository.delete(id, userId);
  }
}
