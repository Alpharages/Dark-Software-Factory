import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ArchitectureReviewNotificationService } from '../architecture-review-notification.service';
import { AdrStatus, RiskLevel } from '@/prisma/client';
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class AdrAlertService {
  private readonly logger = new Logger(AdrAlertService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: ArchitectureReviewNotificationService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async checkQueueDepth() {
    const depth = await this.prisma.adr.count({
      where: { status: AdrStatus.PROPOSED },
    });

    if (depth > 20) {
      await this.handleAlert('QUEUE_DEPTH', `Queue depth is high (${depth} ADRs)`);
    }
  }

  @Cron(CronExpression.EVERY_4_HOURS) // Check periodically
  async checkHighRiskDelays() {
    const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);
    const delayedAdrs = await this.prisma.adr.count({
      where: {
        status: AdrStatus.PROPOSED,
        risk_level: RiskLevel.HIGH,
        created_at: { lt: fourHoursAgo },
      },
    });

    if (delayedAdrs > 0) {
      await this.handleAlert('DELAY', `${delayedAdrs} High-Risk ADRs waiting > 4 hours`);
    }
  }

  async handleAlert(type: string, message: string) {
    // De-duplication check using AdrAlert model
    const lastAlert = await this.prisma.adrAlert.findFirst({
      where: {
        alert_type: type,
        triggered_at: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }, // 24h cooldown/window
      },
    });

    if (lastAlert) {
      this.logger.log(`Skipping alert ${type} - already triggered recently`);
      return;
    }

    // Trigger Alert
    this.logger.warn(`Triggering Alert: ${type} - ${message}`);
    await this.notificationService.notifyAlert(message);

    // Record Alert
    await this.prisma.adrAlert.create({
      data: {
        alert_type: type,
        metadata: { message },
      },
    });
  }
}
