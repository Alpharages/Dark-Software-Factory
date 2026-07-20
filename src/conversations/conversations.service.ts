import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { AICostTrackerService } from '@/cost-tracking/ai-cost-tracker.service';
import { MetricsService } from '@/common/metrics/metrics.service';
import { SentryService } from '@/common/sentry/sentry.service';
import { AIConversationProcessorService } from './ai-conversation-processor.service';
import {
  CreateConversationDto,
  SearchConversationsDto,
  ConversationResponseDto,
  PaginatedConversationsResponseDto,
} from './dto';
import { ActionItem } from './interfaces/action-item.interface';
import { AIProvider } from '@/prisma/client';

/**
 * Conversations Service - Story 5.5
 * Core business logic for client communication intelligence
 */
@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);
  private readonly storagePath: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiProcessor: AIConversationProcessorService,
    private readonly costTracker: AICostTrackerService,
    private readonly metrics: MetricsService,
    private readonly sentry: SentryService,
  ) {
    this.storagePath = process.env.CONVERSATIONS_STORAGE_PATH || './storage/conversations';
  }

  /**
   * Create a new conversation record
   * AC#1: PMs can upload meeting audio/transcript and link to project
   */
  async createConversation(
    dto: CreateConversationDto,
    pmId: string,
    audioFilePath?: string,
  ): Promise<ConversationResponseDto> {
    // Verify project exists
    const project = await this.prisma.project.findUnique({
      where: { id: dto.project_id },
    });

    if (!project) {
      throw new NotFoundException(`Project ${dto.project_id} not found`);
    }

    // Create conversation record
    const conversation = await this.prisma.clientConversation.create({
      data: {
        project_id: dto.project_id,
        pm_id: pmId,
        conversation_date: new Date(dto.conversation_date),
        title: dto.title || `Conversation ${new Date().toISOString().split('T')[0]}`,
        transcript: dto.transcript || '',
        audio_file_url: audioFilePath,
        status: audioFilePath ? 'uploaded' : dto.transcript ? 'uploaded' : 'uploaded',
      },
    });

    this.logger.log(`Created conversation ${conversation.id} for project ${dto.project_id}`);
    this.metrics.incrementConversationCreated();

    return this.mapToDto(conversation);
  }

  /**
   * Process AI analysis for a conversation
   * AC#2: AI generates summary <30 seconds
   * AC#3: AI extracts action items
   * AC#4: Sentiment analysis
   */
  async processAIAnalysis(conversationId: string): Promise<void> {
    const conversation = await this.prisma.clientConversation.findUnique({
      where: { id: conversationId },
    });

    if (!conversation) {
      throw new NotFoundException(`Conversation ${conversationId} not found`);
    }

    const startTime = Date.now();

    try {
      // Update status to processing
      await this.prisma.clientConversation.update({
        where: { id: conversationId },
        data: { status: 'analyzing' },
      });

      let transcript = conversation.transcript;

      // Step 1: Transcribe audio if provided
      if (conversation.audio_file_url && !transcript) {
        this.logger.log(`Transcribing audio for conversation ${conversationId}`);
        await this.prisma.clientConversation.update({
          where: { id: conversationId },
          data: { status: 'transcribing' },
        });

        const transcription = await this.aiProcessor.transcribeAudio(conversation.audio_file_url);

        if (transcription) {
          transcript = transcription.text;
          await this.prisma.clientConversation.update({
            where: { id: conversationId },
            data: { transcript },
          });

          // Log Whisper cost (assuming $0.006 per minute)
          const estimatedMinutes = Math.ceil(transcript.length / 1000); // Rough estimate
          await this.costTracker.logCost({
            ticketId: conversation.id,
            provider: AIProvider.CLAUDE_CODE,
            model: 'whisper-1',
            inputTokens: estimatedMinutes * 60, // Approximate
            outputTokens: this.aiProcessor.estimateTokenCount(transcript),
            agentName: 'WhisperTranscription',
            operationType: 'audio_transcription',
          });

          this.metrics.incrementConversationTranscription();
        } else {
          throw new Error('Transcription failed');
        }
      }

      if (!transcript) {
        throw new Error('No transcript available for analysis');
      }

      // Step 2: Generate summary
      this.logger.log(`Generating summary for conversation ${conversationId}`);
      const summary = await this.aiProcessor.generateSummary(transcript);

      // Step 3: Extract action items
      this.logger.log(`Extracting action items for conversation ${conversationId}`);
      const actionItems = await this.aiProcessor.extractActionItems(transcript);

      // Step 4: Analyze sentiment
      this.logger.log(`Analyzing sentiment for conversation ${conversationId}`);
      const sentiment = await this.aiProcessor.analyzeSentiment(transcript);

      // Calculate processing cost
      const inputTokens = this.aiProcessor.estimateTokenCount(transcript);
      const outputTokens =
        this.aiProcessor.estimateTokenCount(JSON.stringify(summary)) +
        this.aiProcessor.estimateTokenCount(JSON.stringify(actionItems)) +
        100; // Sentiment output

      // Log GPT-4 cost (H2 FIX: Cost tracked in AICosts table)
      const _costResult = await this.costTracker.logCost({
        ticketId: conversation.id,
        provider: AIProvider.CLAUDE_CODE,
        model: 'gpt-4-turbo-preview',
        inputTokens,
        outputTokens,
        agentName: 'ConversationAnalysis',
        operationType: 'conversation_processing',
      });

      // Calculate approximate cost for display
      // NOTE: Full cost retrieval requires CostDashboardService integration (deferred)
      const estimatedCost = (inputTokens * 0.01 + outputTokens * 0.03) / 1000;

      // Update conversation with results

      await this.prisma.clientConversation.update({
        where: { id: conversationId },
        data: {
          summary: summary.summary,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          action_items: actionItems as any,
          sentiment,
          status: 'completed',
          processing_cost: estimatedCost,
        },
      });

      const duration = (Date.now() - startTime) / 1000;
      this.metrics.recordConversationProcessingDuration(duration);
      this.metrics.incrementActionItemsExtracted(actionItems.length);

      this.logger.log(
        `Conversation ${conversationId} processed in ${duration}s (${actionItems.length} action items)`,
      );
    } catch (_error) {
      this.logger.error(
        `Failed to process conversation ${conversationId}: ${(_error as Error).message}`,
        (_error as Error).stack,
      );

      // M3 FIX: Add Sentry error tracking
      this.sentry.captureException(_error as Error, {
        tags: { module: 'conversations', operation: 'processAIAnalysis' },
        extra: { conversationId },
      });

      await this.prisma.clientConversation.update({
        where: { id: conversationId },
        data: { status: 'failed' },
      });

      throw _error;
    }
  }

  /**
   * Search conversations with full-text search and filters
   * AC#6: Searchable by keyword, client, date, project, sentiment
   */
  async searchConversations(
    filters: SearchConversationsDto,
  ): Promise<PaginatedConversationsResponseDto> {
    const { q, projectId, sentiment, startDate, endDate, page, limit, offset } = filters;

    // H3 FIX: Use PostgreSQL full-text search (simplified with contains for MVP)
    // NOTE: Prisma client doesn't expose @@fulltext operators directly
    // Using contains with mode insensitive as fallback - good enough for MVP
    const where: Record<string, unknown> = {};
    const andConditions: unknown[] = [];

    // Full-text search using PostgreSQL @@fulltext index
    if (q) {
      andConditions.push({
        OR: [{ transcript: { search: q } }, { summary: { search: q } }, { title: { search: q } }],
      });
    }

    if (projectId) {
      andConditions.push({ project_id: projectId });
    }

    if (sentiment) {
      andConditions.push({ sentiment });
    }

    if (startDate || endDate) {
      const dateFilter: Record<string, unknown> = {};
      if (startDate) dateFilter.gte = new Date(startDate);
      if (endDate) dateFilter.lte = new Date(endDate);
      andConditions.push({ conversation_date: dateFilter });
    }

    if (andConditions.length > 0) {
      where.AND = andConditions;
    }

    // Determine skip based on offset or page
    const skip = offset !== undefined ? offset : (page - 1) * limit;

    try {
      const [conversations, total] = await Promise.all([
        this.prisma.clientConversation.findMany({
          where,
          include: {
            project: { select: { name: true } },
            pm: { select: { full_name: true, email: true } },
          },
          orderBy: { conversation_date: 'desc' },
          skip,
          take: limit,
        }),
        this.prisma.clientConversation.count({ where }),
      ]);

      this.metrics.incrementConversationSearchQuery();

      const totalPages = Math.ceil(total / limit);

      return {
        conversations: conversations.map((c) => this.mapToDto(c)),
        total,
        page,
        limit,
        totalPages,
        hasMore: page < totalPages,
      };
    } catch (_error) {
      this.logger.error(`Search failed: ${(_error as Error).message}`);
      this.sentry.captureException(_error as Error, {
        tags: { module: 'conversations', operation: 'searchConversations' },
        extra: { filters },
      });
      throw _error;
    }
  }

  /**
   * Get a single conversation by ID
   */
  async getConversationById(id: string): Promise<ConversationResponseDto> {
    const conversation = await this.prisma.clientConversation.findUnique({
      where: { id },
      include: {
        project: { select: { name: true } },
        pm: { select: { full_name: true, email: true } },
      },
    });

    if (!conversation) {
      throw new NotFoundException(`Conversation ${id} not found`);
    }

    return this.mapToDto(conversation);
  }

  /**
   * Map database entity to DTO
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mapToDto(conversation: Record<string, any>): ConversationResponseDto {
    return {
      id: conversation.id as string,
      project_id: conversation.project_id as string,
      pm_id: conversation.pm_id as string,
      conversation_date: (conversation.conversation_date as Date).toISOString(),
      title: conversation.title as string,
      summary: conversation.summary as string,
      action_items: conversation.action_items as ActionItem[],
      sentiment: conversation.sentiment as string | undefined,
      audio_file_url: conversation.audio_file_url as string | undefined,
      status: conversation.status as string,
      processing_cost: conversation.processing_cost as number | undefined,
      created_at: (conversation.created_at as Date).toISOString(),
      updated_at: (conversation.updated_at as Date).toISOString(),
    };
  }
}
