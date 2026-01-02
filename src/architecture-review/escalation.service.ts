import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../database/prisma.service';
import { ArchitectureReviewNotificationService } from './architecture-review-notification.service';
import { AdrStatus, RiskLevel } from '@/prisma/client';

@Injectable()
export class EscalationService {
  private readonly logger = new Logger(EscalationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: ArchitectureReviewNotificationService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async checkHighRiskAdrs() {
    this.logger.log('Checking for stuck high-risk ADRs...');

    // Find High Risk ADRs in PROPOSED status created > 4 hours ago
    const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);

    const stuckAdrs = await this.prisma.adr.findMany({
      where: {
        status: AdrStatus.PROPOSED,
        risk_level: RiskLevel.HIGH,
        created_at: {
          lte: fourHoursAgo,
        },
      },
    });

    if (stuckAdrs.length > 0) {
      this.logger.warn(`Found ${stuckAdrs.length} stuck High Risk ADRs. Escalating...`);
      for (const adr of stuckAdrs) {
        await this.notificationService.notifyStuckEscalation(adr);
      }
    }
  }
}
