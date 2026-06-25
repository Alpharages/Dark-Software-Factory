import { Module } from '@nestjs/common';
import { SubscriptionCompletionService } from './subscription-completion.service';

/**
 * Provides the subscription-backed one-shot completion helper used by AI
 * features that previously called the Anthropic API directly (PM field
 * auto-fill, PR title/body generation, file-conflict prediction).
 */
@Module({
  providers: [SubscriptionCompletionService],
  exports: [SubscriptionCompletionService],
})
export class SubscriptionCompletionModule {}
