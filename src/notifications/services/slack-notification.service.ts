import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WebClient } from '@slack/web-api';

@Injectable()
export class SlackNotificationService {
  private readonly logger = new Logger(SlackNotificationService.name);
  private slackClient!: WebClient;
  private enabled: boolean = false;

  constructor(private readonly configService: ConfigService) {
    const token = this.configService.get<string>('SLACK_BOT_TOKEN');
    if (token) {
      this.slackClient = new WebClient(token);
      this.enabled = true;
    } else {
      this.logger.warn('SLACK_BOT_TOKEN not configured. Slack notifications disabled.');
    }
  }

  async sendSlackMessage(
    userId: string,
    eventType: string,
    payload: Record<string, unknown>,
    slackMemberId?: string,
  ): Promise<void> {
    if (!this.enabled) {
      this.logger.debug('Slack notifications disabled');
      return;
    }

    if (!slackMemberId) {
      this.logger.warn(
        `No Slack member ID provided for user ${userId}. Cannot send Slack notification.`,
      );
      return;
    }

    try {
      const blocks = this.formatSlackBlocks(eventType, payload);

      await this.slackClient.chat.postMessage({
        channel: slackMemberId,
        text: `Notification: ${this.formatEventTitle(eventType)}`,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        blocks: blocks as any,
      });

      this.logger.debug(
        `Slack notification sent to user ${userId} (${slackMemberId}) for event ${eventType}`,
      );
    } catch (error) {
      this.logger.error(`Failed to send Slack notification to user ${userId}:`, error);
      throw error;
    }
  }

  private formatSlackBlocks(eventType: string, payload: Record<string, unknown>): unknown[] {
    const title = this.formatEventTitle(eventType);

    return [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `🔔 ${title}`,
          emoji: true,
        },
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Project:*\n${payload.projectName || payload.projectId || 'N/A'}`,
          },
          {
            type: 'mrkdwn',
            text: `*Time:*\n${new Date().toLocaleString()}`,
          },
        ],
      },
      // Add more dynamic fields based on payload content if needed
      ...(payload.message
        ? [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*Message:*\n${payload.message}`,
              },
            },
          ]
        : []),
      ...(payload.severity
        ? [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*Severity:* ${payload.severity}`,
              },
            },
          ]
        : []),
    ];
  }

  private formatEventTitle(eventType: string): string {
    const titles = new Map<string, string>([
      ['execution.completed', 'AI Execution Completed'],
      ['execution.failed', 'AI Execution Failed'],
      ['execution.started', 'AI Execution Started'],
      ['quality.failure', 'Quality Gate Failed'],
      ['cost.threshold_exceeded', 'Cost Threshold Exceeded'],
      ['deployment.success', 'Deployment Successful'],
      ['deployment.failure', 'Deployment Failed'],
    ]);

    return titles.get(eventType) || eventType;
  }
}
