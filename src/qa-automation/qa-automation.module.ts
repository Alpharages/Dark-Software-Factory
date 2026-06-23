import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { makeCounterProvider, makeHistogramProvider } from '@willsoto/nestjs-prometheus';
import { DatabaseModule } from '../database/database.module';
import { SentryModule } from '../common/sentry/sentry.module';
import { LoggerModule } from '../common/logger/logger.module';
import { AppMetricsModule } from '../common/metrics/metrics.module';
import { QualityGatesService } from './quality-gates.service';
import { QaNotificationService } from './services/qa-notification.service'; // Story 10.3
import { QA_METRICS, METRICS_CONSTANTS } from '../common/metrics/metrics.constants';

import { RealtimeModule } from '../realtime/realtime.module'; // Story 10.3
import { QualityGateConfigModule } from './quality-gate-config/quality-gate-config.module';

@Module({
  imports: [
    DatabaseModule,
    SentryModule,
    ConfigModule,
    LoggerModule,
    AppMetricsModule,
    forwardRef(() => RealtimeModule), // Story 10.3: For QA notifications
    QualityGateConfigModule,
  ],
  controllers: [],
  providers: [
    QualityGatesService,
    QaNotificationService, // Story 10.3
    makeCounterProvider({
      name: QA_METRICS.QUALITY_GATE_EVALUATIONS_TOTAL,
      help: 'Total quality gate evaluations',
      labelNames: ['status', 'project_id'],
    }),
    makeHistogramProvider({
      name: QA_METRICS.QUALITY_GATE_DURATION,
      help: 'Quality gate evaluation duration in seconds',
      buckets: METRICS_CONSTANTS.DEFAULT_BUCKETS,
    }),
    makeHistogramProvider({
      name: QA_METRICS.QUALITY_SCORE_HISTOGRAM,
      help: 'Distribution of quality scores (0-100)',
      labelNames: ['project_id'],
      buckets: [0, 20, 40, 60, 70, 80, 90, 100],
    }),

    // Story 10.3: QA Notification Metrics
    makeCounterProvider({
      name: 'qa_notifications_emitted_total',
      help: 'Total QA notifications emitted',
      labelNames: ['gate_type', 'severity'],
    }),
    makeCounterProvider({
      name: 'qa_notification_emission_errors_total',
      help: 'Total QA notification emission errors',
      labelNames: ['event', 'reason'],
    }),
  ],
  exports: [QualityGatesService, QaNotificationService],
})
export class QaAutomationModule {}
