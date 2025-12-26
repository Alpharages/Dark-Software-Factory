import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { JwtAuthGuard, RolesGuard } from '@/common/guards';
import { Roles, CurrentUser } from '@/common/decorators';
import { ConversationsService } from './conversations.service';
import {
  CreateConversationDto,
  SearchConversationsDto,
  ConversationResponseDto,
  PaginatedConversationsResponseDto,
  CreateTicketsDto,
} from './dto';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Conversations Controller - Story 5.5
 * REST API for client communication intelligence
 */
@ApiTags('Conversations')
@Controller('api/v1/conversations')
@UseGuards(JwtAuthGuard, RolesGuard, ThrottlerGuard)
@ApiBearerAuth()
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  /**
   * POST /upload - Upload audio file
   * AC#1: PMs can upload meeting audio and link to project
   */
  @Post('upload')
  @HttpCode(HttpStatus.CREATED)
  @Roles('PM', 'MANAGER')
  @Throttle({ default: { limit: 50, ttl: 60000 } })
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Upload conversation audio file (AC#1)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'project_id', 'conversation_date'],
      properties: {
        file: { type: 'string', format: 'binary' },
        project_id: { type: 'string', format: 'uuid' },
        conversation_date: { type: 'string', format: 'date-time' },
        title: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Audio uploaded' })
  async uploadAudio(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 25 * 1024 * 1024 }), // 25 MB
          new FileTypeValidator({ fileType: /(audio\/)/ }),
        ],
        fileIsRequired: true,
      }),
    )
    file: Express.Multer.File,
    @Body() dto: CreateConversationDto,
    @CurrentUser() user: any,
  ): Promise<ConversationResponseDto> {
    if (!file) throw new BadRequestException('Audio file is required');

    // Store file to disk (Story 5.5 AC#1)
    const storagePath = process.env.CONVERSATIONS_STORAGE_PATH || './storage/conversations';
    const projectDir = path.join(storagePath, dto.project_id);
    const filename = `${Date.now()}-${file.originalname}`;
    const filePath = path.join(projectDir, filename);

    // Create directory if it doesn't exist
    await fs.mkdir(projectDir, { recursive: true });

    // Write file to disk
    await fs.writeFile(filePath, file.buffer);

    return this.conversationsService.createConversation(dto, user.sub, filePath);
  }

  /**
   * POST / - Create conversation with text transcript
   * AC#1: PMs can upload transcript and link to project
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles('PM', 'MANAGER')
  @ApiOperation({ summary: 'Create conversation with text transcript (AC#1)' })
  @ApiResponse({ status: 201 })
  async createConversation(
    @Body() dto: CreateConversationDto,
    @CurrentUser() user: any,
  ): Promise<ConversationResponseDto> {
    return this.conversationsService.createConversation(dto, user.sub);
  }

  /**
   * POST /:id/process - Trigger AI analysis
   * AC#2: AI generates summary <30 seconds
   * AC#3: AI extracts action items
   * AC#4: Sentiment analysis
   */
  @Post(':id/process')
  @HttpCode(HttpStatus.ACCEPTED)
  @Roles('PM', 'MANAGER')
  @ApiOperation({ summary: 'Trigger AI analysis (AC#2, AC#3, AC#4)' })
  @ApiResponse({ status: 202, description: 'Processing started' })
  async processConversation(@Param('id', ParseUUIDPipe) id: string): Promise<{ message: string }> {
    this.conversationsService.processAIAnalysis(id).catch((err) => {
      console.error(`Background processing failed for conversation ${id}:`, err);
    });

    return { message: 'AI processing started' };
  }

  /**
   * GET / - List conversations
   */
  @Get()
  @Roles('PM', 'MANAGER')
  @ApiOperation({ summary: 'List conversations (filterable)' })
  @ApiResponse({ status: 200 })
  async listConversations(
    @Query() filters: SearchConversationsDto,
  ): Promise<PaginatedConversationsResponseDto> {
    return this.conversationsService.searchConversations(filters);
  }

  /**
   * GET /search - Full-text search
   * AC#6: Searchable by keyword, client, date, project, sentiment
   */
  @Get('search')
  @Roles('PM', 'MANAGER')
  @ApiOperation({ summary: 'Search conversations (AC#6)' })
  @ApiResponse({ status: 200 })
  async searchConversations(
    @Query() filters: SearchConversationsDto,
  ): Promise<PaginatedConversationsResponseDto> {
    return this.conversationsService.searchConversations(filters);
  }

  /**
   * GET /:id - Get single conversation
   */
  @Get(':id')
  @Roles('PM', 'MANAGER')
  @ApiOperation({ summary: 'Get conversation by ID' })
  @ApiResponse({ status: 200 })
  async getConversation(@Param('id', ParseUUIDPipe) id: string): Promise<ConversationResponseDto> {
    return this.conversationsService.getConversationById(id);
  }

  /**
   * POST /:id/create-tickets - Create ClickUp tickets from action items
   * AC#5: Auto-tickets require PM approval
   */
  @Post(':id/create-tickets')
  @HttpCode(HttpStatus.CREATED)
  @Roles('PM', 'MANAGER')
  @ApiOperation({ summary: 'Create tickets from action items (AC#5)' })
  @ApiResponse({ status: 201, description: 'Tickets created' })
  async createTickets(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateTicketsDto,
  ): Promise<{ message: string; count: number }> {
    await this.conversationsService.createTicketsFromActionItems(id, dto.action_item_ids);
    return { message: 'Tickets created successfully', count: dto.action_item_ids.length };
  }
}
