import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '@/database/database.module';
import { CostTrackingModule } from '@/cost-tracking/cost-tracking.module';
import { AppMetricsModule } from '@/common/metrics';
import { AetherFlowModule } from '@/integrations/aetherflow/aetherflow.module';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { AIConversationProcessorService } from './ai-conversation-processor.service';

/**
 * Conversations Module - Story 5.5
 * Client communication intelligence with AI transcription and analysis
 */
@Module({
  imports: [ConfigModule, DatabaseModule, CostTrackingModule, AppMetricsModule, AetherFlowModule],
  controllers: [ConversationsController],
  providers: [ConversationsService, AIConversationProcessorService],
  exports: [ConversationsService, AIConversationProcessorService],
})
export class ConversationsModule {}
