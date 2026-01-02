import { Module } from '@nestjs/common';
import { DecisionDashboardController } from './decision-dashboard.controller';
import { DecisionService } from './decision.service';
import { DatabaseModule } from '../database/database.module';
import { CostTrackingModule } from '../cost-tracking/cost-tracking.module';
import { AIDecisionLoggerModule } from '../audit/ai-decision-logger.module'; // Likely AIDecisionLoggerModule, check file
import { ExecutionModule } from '../execution/execution.module';

@Module({
  imports: [
    DatabaseModule,
    CostTrackingModule,
    AIDecisionLoggerModule, // Check this name
    ExecutionModule,
  ],
  controllers: [DecisionDashboardController],
  providers: [DecisionService],
})
export class DecisionDashboardModule {}
