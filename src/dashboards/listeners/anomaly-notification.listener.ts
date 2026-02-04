import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventBusService } from '@/common/event-bus.service';
import { QualityAnomalyDetectedEvent } from '../events/quality-anomaly-detected.event';
import { EmailService } from '@/common/email/email.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AnomalyNotificationListener implements OnModuleInit {
  private readonly logger = new Logger(AnomalyNotificationListener.name);

  constructor(
    private readonly eventBus: EventBusService,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit() {
    this.eventBus.on('quality.anomaly.detected', (event: QualityAnomalyDetectedEvent) =>
      this.handleAnomalyDetected(event),
    );
  }

  async handleAnomalyDetected(event: QualityAnomalyDetectedEvent) {
    this.logger.log(`Handling anomaly alert for ${event.metric} in project ${event.projectId}`);

    //1. Email Notification for Critical anomalies
    if (event.severity === 'critical') {
      const leadQaEmails = this.configService.get<string>('LEAD_QA_EMAILS')?.split(',') || [];

      for (const email of leadQaEmails) {
        try {
          await this.emailService.sendEmail({
            to: email,
            subject: `🚨 CRITICAL Quality Anomaly Detected - ${event.metric}`,
            body: `
              <h2>Critical Quality Anomaly Detected</h2>
              <p><strong>Project:</strong> ${event.projectId}</p>
              <p><strong>Metric:</strong> ${event.metric}</p>
              <p><strong>Type:</strong> ${event.type}</p>
              <p><strong>Current Value:</strong> ${event.currentValue}</p>
              <p><strong>Previous Value:</strong> ${event.previousValue ?? 'N/A'}</p>
              <p>Please investigate immediately in the QA Dashboard.</p>
            `,
          });
          this.logger.log(`Sent critical anomaly email to ${email}`);
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.error(`Failed to send anomaly email to ${email}: ${message}`);
        }
      }
    }

    // 2. Slack Notification (Placeholder - requires Slack integration)
    const slackEnabled = this.configService.get<boolean>('SLACK_NOTIFICATIONS_ENABLED');
    if (slackEnabled) {
      this.logger.log(`Posting anomaly alert to Slack for project ${event.projectId}`);
      // TODO: Implement Slack webhook integration when available
    }
  }
}
