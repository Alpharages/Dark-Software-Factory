import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { MetricsService } from '../common/metrics/metrics.service';
import { AuditLogService } from '../common/audit/audit-log.service';
import { OrchestratorService } from '../ai-routing/orchestrator.service'; // Story 5.6
import { GenerateReportDto } from './dto/generate-report.dto';
import { ReportsAggregatorService } from './reports-aggregator.service';
import { ReportsExporterService } from './reports-exporter.service';
import { Readable } from 'stream';
import { AIDecisionLoggerService } from '../audit/ai-decision-logger.service';

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly aggregator: ReportsAggregatorService,
    private readonly exporter: ReportsExporterService,
    private readonly orchestrator: OrchestratorService,
    private readonly metrics: MetricsService,
    private readonly aiLogger: AIDecisionLoggerService,
  ) {}

  async generateSprintReport(dto: GenerateReportDto, userId: string) {
    const { project_id, date_start, date_end } = dto;

    // Verify project access
    const project = await this.prisma.project.findUnique({
      where: { id: project_id },
    });

    if (!project) {
      throw new NotFoundException(`Project ${project_id} not found`);
    }

    if (project.pm_id !== userId) {
      throw new Error(`Unauthorized: User ${userId} does not have access to project ${project_id}`);
    }

    // Check cache - include type in cache key (AC#4 fix)
    const existingReport = await this.prisma.report.findFirst({
      where: {
        project_id,
        date_start: new Date(date_start),
        date_end: new Date(date_end),
        type: 'SPRINT',
        status: 'COMPLETED',
      },
    });

    if (existingReport) {
      this.logger.log(`Returning cached report for project ${project_id}`);
      this.metrics.setGauge('report_cache_hits_total', 1, { project_id });
      return existingReport;
    }

    // Create new report record
    const report = await this.prisma.report.create({
      data: {
        project_id,
        title:
          dto.title ||
          `Sprint Report: ${new Date(date_start).toLocaleDateString()} - ${new Date(date_end).toLocaleDateString()}`,
        status: 'PENDING',
        date_start: new Date(date_start),
        date_end: new Date(date_end),
        type: 'SPRINT',
      },
    });

    // Start background generation
    this.processReport(report.id).catch((err) => {
      this.logger.error(`Failed to process report ${report.id}: ${err.message}`);
    });

    return report;
  }

  private async processReport(reportId: string) {
    const startTime = Date.now();
    try {
      await this.prisma.report.update({
        where: { id: reportId },
        data: { status: 'PROCESSING' },
      });

      const report = await this.prisma.report.findUnique({
        where: { id: reportId },
        include: { project: true },
      });

      if (!report) {
        throw new Error(`Report ${reportId} not found during processing`);
      }

      // 1. Aggregate Data
      const aggregatedData = await this.aggregator.aggregateData(
        report.project_id,
        report.date_start,
        report.date_end,
      );

      // 2. AI Content Generation (Narrative, Insights) - ADR-008
      const prompt = `You are an expert project manager. Generate a professional narrative for a sprint report based on the following data:
            
            PROJECT: ${report.project.name}
            PERIOD: ${report.date_start.toLocaleDateString()} to ${report.date_end.toLocaleDateString()}
            
            METRICS:
            - Completed Tickets: ${aggregatedData.summary.completed_tickets}
            - Total Complexity Points: ${aggregatedData.summary.total_complexity}
            - Velocity (Pts/Week): ${aggregatedData.summary.velocity}
            - QA Pass Rate: ${aggregatedData.quality_metrics.average_qa_pass_rate}%
            - Test Coverage: ${aggregatedData.quality_metrics.average_test_coverage}%
            
            UPCOMING:
            - Planned Tickets: ${aggregatedData.upcoming_sprint_plan.ticket_count}
            - Top Priorities: ${aggregatedData.upcoming_sprint_plan.top_priorities.map((t: any) => t.title).join(', ')}
            
            Please provide:
            1. A concise summary (max 200 chars)
            2. A detailed narrative of accomplishments (2-3 paragraphs)
            3. Key strategic insights and recommendations based on the quality metrics and velocity.
            
            Output JSON:
            { "summary": "...", "narrative": "...", "insights": "..." }`;

      const aiResult = await this.orchestrator.executeTask({
        correlationId: `report-${reportId}`,
        ticketId: report.project_id,
        prompt,
        agentName: 'ReportsService',
        action: 'generate_report_narrative',
      });

      let summary = `Summary of sprint for ${report.project.name}`;
      let narrative = `In this sprint, we completed ${aggregatedData.summary.completed_tickets} tickets with a velocity of ${aggregatedData.summary.velocity} points/week.`;
      let insights = `QA pass rate is at ${aggregatedData.quality_metrics.average_qa_pass_rate}%.`;

      if (aiResult.success) {
        try {
          // Harden JSON parsing (AC#5 fix)
          const jsonContent = aiResult.output.substring(
            aiResult.output.indexOf('{'),
            aiResult.output.lastIndexOf('}') + 1,
          );
          const parsed = JSON.parse(jsonContent);
          summary = parsed.summary || summary;
          narrative = parsed.narrative || narrative;
          insights = parsed.insights || insights;
        } catch (e: any) {
          this.logger.warn(`Failed to parse AI response as JSON, using raw output: ${e.message}`);
          narrative = aiResult.output;
        }
      }

      // 3. Update Report with data and content
      await this.prisma.report.update({
        where: { id: reportId },
        data: {
          status: 'COMPLETED',
          raw_data: aggregatedData as any,
          summary,
          narrative,
          insights,
        },
      });

      // Log AI Decision (ADR-008 compliance)
      await this.aiLogger.logDecision({
        agentName: 'ReportsService',
        action: 'generate_report_narrative',
        reasoning: 'Generated sprint report narrative based on mission metrics and velocity.',
        ticketId: report.project_id,
        executionId: reportId,
        inputData: { metrics: aggregatedData.summary, quality: aggregatedData.quality_metrics },
        outputData: { summary, insights },
        confidence: 0.95,
      });

      // 4. Audit Log (ADR-008 & Story 11.2)
      await this.audit.log({
        action: 'generate_report',
        entityType: 'report',
        entityId: reportId,
        actorType: 'system',
        afterState: { status: 'COMPLETED', project_id: report.project_id },
      });

      const duration = (Date.now() - startTime) / 1000;
      this.metrics.recordHistogram('report_generation_duration_seconds', duration, {
        project_id: report.project_id,
      });
    } catch (error: any) {
      this.logger.error(`Error processing report ${reportId}: ${error.stack}`);
      await this.prisma.report
        .update({
          where: { id: reportId },
          data: { status: 'FAILED' },
        })
        .catch(() => {});

      this.metrics.setGauge('report_generation_failures_total', 1, {
        reason: error.message || 'unknown',
      });
      throw error;
    }
  }

  async getReport(id: string, userId: string) {
    const report = await this.prisma.report.findUnique({
      where: { id },
      include: { project: true },
    });

    if (!report) throw new NotFoundException(`Report ${id} not found`);

    if ((report as any).project.pm_id !== userId) {
      throw new Error(`Unauthorized: User ${userId} does not have access to report ${id}`);
    }

    return report;
  }

  async getReportFileStream(id: string, format: 'pdf' | 'pptx', userId: string): Promise<Readable> {
    const report = await this.getReport(id, userId);
    return this.exporter.exportReport(report, format);
  }
}
