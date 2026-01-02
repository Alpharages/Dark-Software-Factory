import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AdrStatus, RiskLevel, Prisma } from '@/prisma/client';

@Injectable()
export class AdrInsightsService {
  private readonly logger = new Logger(AdrInsightsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async generateInsights(projectId?: string): Promise<{ patterns: string[] }> {
    const insights: string[] = [];
    const where: Prisma.AdrWhereInput = {};

    if (projectId) {
      where.execution = { ticket: { project_id: projectId } };
    }

    try {
      // 1. Review Time Analysis (High Risk)
      const highRiskReviews = await this.prisma.adr.findMany({
        where: {
          ...where,
          risk_level: RiskLevel.HIGH,
          review_duration_seconds: { not: null },
        },
        select: { review_duration_seconds: true },
      });

      if (highRiskReviews.length > 0) {
        const avgSeconds =
          highRiskReviews.reduce((acc, curr) => acc + (curr.review_duration_seconds || 0), 0) /
          highRiskReviews.length;
        const avgMinutes = Math.round(avgSeconds / 60);
        insights.push(`High-risk decisions take ${avgMinutes} minutes average to review`);
      } else {
        insights.push(`Not enough data for high-risk review time analysis`);
      }

      // 2. Approval Rate Analysis (Low Risk)
      const lowRiskCount = await this.prisma.adr.count({
        where: { ...where, risk_level: RiskLevel.LOW },
      });

      if (lowRiskCount > 0) {
        const lowRiskApproved = await this.prisma.adr.count({
          where: { ...where, risk_level: RiskLevel.LOW, status: AdrStatus.ACCEPTED },
        });
        const rate = Math.round((lowRiskApproved / lowRiskCount) * 100);
        insights.push(`${rate}% of low-risk decisions are approved`);
      }

      // 3. Learning / Volume
      const totalAdrs = await this.prisma.adr.count({ where });
      if (totalAdrs > 0) {
        const rejected = await this.prisma.adr.count({
          where: { ...where, status: AdrStatus.REJECTED },
        });
        if (rejected > 0) {
          insights.push(`${rejected} decisions rejected - Review taxonomy for common patterns`);
        } else {
          insights.push(`Approval workflow is healthy (0 rejections)`);
        }
      } else {
        insights.push(`No architecture decisions recorded yet`);
      }
    } catch (_error) {
      this.logger.error(`Failed to generate insights: ${(_error as Error).message}`);
      insights.push('Unable to generate insights due to error');
    }

    return { patterns: insights };
  }
}
