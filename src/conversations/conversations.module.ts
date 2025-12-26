import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '@/database/database.module';
import { CostTrackingModule } from '@/cost-tracking/cost-tracking.module';
import { AppMetricsModule } from '@/common/metrics';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { AIConversationProcessorService } from './ai-conversation-processor.service';

/**
 * Conversations Module - Story 5.5
 * Client communication intelligence with AI transcription and analysis
 */
@Module({
    imports: [
        ConfigModule,
        DatabaseModule,
        CostTrackingModule,
        AppMetricsModule,
    ],
    controllers: [ConversationsController],
    providers: [
        ConversationsService,
        AIConversationProcessorService,
    ],
    exports: [ConversationsService],
})
export class ConversationsModule { }
