import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter, Gauge, Histogram } from 'prom-client';
import { AdrStatus, RiskLevel, Prisma } from '@/prisma/client';
import { MetricsService } from '../../common/metrics/metrics.service';
import { categorizeRejectionReason } from './rejection-reason.helper';
import { AdrMetricsDto, AdrTrendsDto } from './dto/adr-metrics.dto';

@Injectable()
export class AdrMetricsService {
    private readonly logger = new Logger(AdrMetricsService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly metricsService: MetricsService,
        @InjectMetric('adr_reviews_total') public reviewsTotal: Counter<string>,
        @InjectMetric('adr_review_duration_seconds') public reviewDuration: Histogram<string>,
        @InjectMetric('adr_queue_depth') public queueDepth: Gauge<string>,
        @InjectMetric('adr_approval_rate') public approvalRate: Gauge<string>,
    ) { }

    /**
     * Hook called after an ADR review is completed
     */
    async trackReviewCompleted(adr: any, action: string, reason?: string) {
        this.logger.log(`Tracking review metrics for ADR ${adr.id}, Action: ${action}`);

        try {
            const riskLevel = adr.risk_level || 'UNKNOWN';
            const projectId = adr.execution?.ticket?.project_id || 'unknown';

            // 1. Update Prometheus Counter
            this.reviewsTotal.labels(action, riskLevel, projectId).inc();

            // 2. Track Duration (if available)
            if (adr.review_duration_seconds) {
                this.reviewDuration.labels(riskLevel).observe(adr.review_duration_seconds);
            }

            // 3. Update Approval Rate Gauge (re-calculate for this project/status)
            // Note: Gauges usually updated periodically, but we can do reactive update too
            // or just rely on the cron.

            // 4. Update Queue Depth
            await this.updateQueueDepthGauge();

            // 5. Update DB (if not already handled by AdrService, but AdrService calls this AFTER update)
            // We assume DB fields (reviewed_at, etc) are updated by AdrService or passed in 'adr' object

            // If REJECTED, categorize reason (for internal analytics, maybe store in separate table if we had one, 
            // but we added rejection_reason to Adr model)
        } catch (error: any) {
            this.logger.error(`Failed to track review metrics: ${error.message}`, error.stack);
        }
    }

    /**
     * Update queue depth gauge
     */
    async updateQueueDepthGauge() {
        const depth = await this.prisma.adr.count({
            where: { status: AdrStatus.PROPOSED }
        });
        this.queueDepth.set(depth);
    }

    /**
     * Get aggregated metrics for dashboard
     */
    async getReviewMetrics(projectId?: string): Promise<AdrMetricsDto> {
        // Implementation for AC#5
        const where = projectId ? { execution: { ticket: { project_id: projectId } } } : {};

        // Review Volume (Last 30 days)
        // Using raw query for volume by day.

        const volumeRaw = await this.prisma.$queryRaw<{ date: Date, count: bigint }[]>`
            SELECT DATE(created_at) as date, COUNT(*) as count 
            FROM adrs 
            WHERE created_at >= NOW() - INTERVAL '30 days'
            ${projectId ? Prisma.sql`AND execution_id IN (SELECT id FROM executions WHERE ticket_id IN (SELECT id FROM tickets WHERE project_id = ${projectId}))` : Prisma.empty}
            GROUP BY DATE(created_at)
        `;

        const review_volume: Record<string, number> = {};
        volumeRaw.forEach(r => {
            // Ensure date object handling
            const d = new Date(r.date);
            const dateStr = d.toISOString().split('T')[0];
            review_volume[dateStr] = Number(r.count);
        });

        // Approval Rate
        const statusCounts = await this.prisma.adr.groupBy({
            by: ['status'],
            where,
            _count: true
        });
        const totalAdrs = statusCounts.reduce((acc, curr) => acc + curr._count, 0);
        const approval_rate: Record<string, number> = {};
        statusCounts.forEach(s => {
            approval_rate[s.status] = totalAdrs > 0 ? (s._count / totalAdrs) * 100 : 0;
        });

        // Risk Distribution
        const riskCounts = await this.prisma.adr.groupBy({
            by: ['risk_level'],
            where,
            _count: true
        });
        const risk_distribution: Record<string, number> = {};
        riskCounts.forEach(r => {
            if (r.risk_level) risk_distribution[r.risk_level as string] = r._count;
        });

        // Top Rejection Reasons
        const rejections = await this.prisma.adr.findMany({
            where: {
                ...where,
                status: AdrStatus.REJECTED,
                rejection_reason: { not: null }
            },
            select: { rejection_reason: true }
        });
        const rejection_reasons: Record<string, number> = {};
        rejections.forEach(r => {
            if (r.rejection_reason) {
                const cat = categorizeRejectionReason(r.rejection_reason);
                rejection_reasons[cat] = (rejection_reasons[cat] || 0) + 1;
            }
        });

        // Queue Metrics
        const current_depth = await this.prisma.adr.count({ where: { status: AdrStatus.PROPOSED } });
        // Average wait time (Proposed ADRs created_at vs NOW)
        const proposedAdrs = await this.prisma.adr.findMany({
            where: { status: AdrStatus.PROPOSED },
            select: { created_at: true }
        });
        let totalWait = 0;
        const now = new Date();
        proposedAdrs.forEach(a => {
            totalWait += (now.getTime() - a.created_at.getTime()) / 1000 / 60; // minutes
        });
        const average_wait_time_minutes = proposedAdrs.length > 0 ? totalWait / proposedAdrs.length : 0;

        const metrics = new AdrMetricsDto();
        metrics.review_volume = review_volume;
        metrics.approval_rate = approval_rate;
        metrics.risk_distribution = risk_distribution;
        metrics.top_rejection_reasons = rejection_reasons;
        metrics.queue_metrics.current_depth = current_depth;
        metrics.queue_metrics.average_wait_time_minutes = Math.round(average_wait_time_minutes * 10) / 10;

        return metrics;
    }

    async getTrendAnalysis(projectId?: string): Promise<AdrTrendsDto> {
        const trends = new AdrTrendsDto();
        trends.approval_rate_trend = [];
        trends.review_volume_trend = [];
        trends.learning_insights = []; // Populated by controller

        try {
            // 1. Review Volume (Last 7 Days)
            // Note: Prisma raw query returns BigInt for count, need to handle serialization
            const volumeRaw = await this.prisma.$queryRaw<{ date: Date, count: bigint }[]>`
                SELECT DATE(created_at) as date, COUNT(*)::bigint as count 
                FROM "adrs" 
                WHERE created_at >= NOW() - INTERVAL '7 days'
                ${projectId ? Prisma.sql`AND execution_id IN (SELECT id FROM executions WHERE ticket_id IN (SELECT id FROM tickets WHERE project_id = ${projectId}))` : Prisma.empty}
                GROUP BY DATE(created_at)
                ORDER BY DATE(created_at) ASC
            `;

            // 2. Approved Count (Last 7 Days)
            const approvedRaw = await this.prisma.$queryRaw<{ date: Date, count: bigint }[]>`
                SELECT DATE(created_at) as date, COUNT(*)::bigint as count 
                FROM "adrs" 
                WHERE status = 'ACCEPTED' AND created_at >= NOW() - INTERVAL '7 days'
                ${projectId ? Prisma.sql`AND execution_id IN (SELECT id FROM executions WHERE ticket_id IN (SELECT id FROM tickets WHERE project_id = ${projectId}))` : Prisma.empty}
                GROUP BY DATE(created_at)
                ORDER BY DATE(created_at) ASC
            `;

            // Process results
            const resultMap = new Map<string, { total: number, approved: number }>();

            volumeRaw.forEach(r => {
                const day = new Date(r.date).toISOString().split('T')[0];
                resultMap.set(day, { total: Number(r.count), approved: 0 });
            });

            approvedRaw.forEach(r => {
                const day = new Date(r.date).toISOString().split('T')[0];
                if (resultMap.has(day)) {
                    resultMap.get(day)!.approved = Number(r.count);
                }
            });

            // Flatten to Arrays
            resultMap.forEach((val, date) => {
                trends.review_volume_trend.push({ date, value: val.total });
                const rate = val.total > 0 ? (val.approved / val.total) * 100 : 0;
                trends.approval_rate_trend.push({ date, value: Math.round(rate * 10) / 10 }); // Round to 1 decimal
            });

        } catch (error: any) {
            this.logger.error(`Failed to get trend analysis: ${error.message}`);
        }

        return trends;
    }
}
