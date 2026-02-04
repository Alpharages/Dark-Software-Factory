import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { QualityDashboardService } from './quality-dashboard.service';
import { AIDecisionLoggerService } from '@/audit/ai-decision-logger.service';
import { DashboardGateway } from '../gateways/dashboard.gateway';
import { AIConversationProcessorService } from '@/conversations/ai-conversation-processor.service';
import {
  AnomalyDto,
  AnomalyType,
  AnomalyMetric,
  AnomalySeverity,
  AnomalyStatus,
  AnomalyQueryDto,
  AnomalyResolutionDto,
  AnomalyConfigDto,
  AIAnalysisDto,
} from '../dto/anomaly-detection.dto';
import { EventBusService } from '@/common/event-bus.service';
import { QualityAnomalyDetectedEvent } from '../events/quality-anomaly-detected.event';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@/prisma/client';
import { QualityMetricsResponseDto, MetricItemDto } from '../dto/quality-dashboard.dto';

interface DetectedAnomaly {
  type: AnomalyType;
  metric: AnomalyMetric;
  severity: AnomalySeverity;
  values: {
    current: number;
    previous?: number;
    change_percent?: number;
    expected_range?: { min: number; max: number };
  };
}

@Injectable()
export class AnomalyDetectionService {
  private readonly logger = new Logger(AnomalyDetectionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly qualityDashboardService: QualityDashboardService,
    private readonly aiDecisionLogger: AIDecisionLoggerService,
    private readonly dashboardGateway: DashboardGateway,
    private readonly aiProcessor: AIConversationProcessorService,
    private readonly eventBus: EventBusService,
  ) {}

  /**
   * Main entry point for detecting anomalies
   */
  async detectAnomalies(query: AnomalyQueryDto): Promise<AnomalyDto[]> {
    const { status, severity, project_id, from_date, to_date, page = 1, limit = 20 } = query;

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (severity) where.severity = severity;
    if (project_id) where.project_id = project_id;
    if (from_date || to_date) {
      const detectedAt: Record<string, unknown> = {};
      if (from_date) detectedAt.gte = from_date;
      if (to_date) detectedAt.lte = to_date;
      where.detected_at = detectedAt;
    }

    const anomalies = await this.prisma.qualityAnomaly.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { detected_at: 'desc' },
    });

    // Map to DTOs
    // Note: We'd need project names, which could be fetched in bulk or joined
    const projectIds = [...new Set(anomalies.map((a) => a.project_id))];
    const projects = await this.prisma.project.findMany({
      where: { id: { in: projectIds } },
      select: { id: true, name: true },
    });
    const projectMap = new Map(projects.map((p) => [p.id, p.name]));

    return anomalies.map((a) => ({
      id: a.id,
      type: a.type as AnomalyType,
      metric: a.metric as AnomalyMetric,
      severity: a.severity as AnomalySeverity,
      project_id: a.project_id,
      project_name: projectMap.get(a.project_id) || 'Unknown Project',
      detected_at: a.detected_at,
      values: {
        current: a.current_value,
        previous: a.previous_value || undefined,
        expected_range:
          a.expected_min !== null && a.expected_max !== null
            ? {
                min: a.expected_min,
                max: a.expected_max,
              }
            : undefined,
        change_percent: a.change_percent || undefined,
      },
      ai_analysis: a.ai_analysis as unknown as AIAnalysisDto,
      status: a.status as AnomalyStatus,
      resolution: a.resolved_at
        ? {
            resolved_at: a.resolved_at,
            resolved_by: a.resolved_by || 'Unknown',
            notes: a.resolution_notes || '',
          }
        : undefined,
    }));
  }

  /**
   * Trigger detection for all projects (Scheduled)
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async runScheduledAnalysis() {
    this.logger.log('Starting scheduled anomaly detection analysis...');
    const projects = await this.prisma.project.findMany({ where: { is_active: true } });

    for (const project of projects) {
      try {
        await this.analyzeProject(project.id);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Failed to analyze project ${project.id}: ${message}`);
      }
    }
  }

  /**
   * Analyze a single project for anomalies
   */
  async analyzeProject(projectId: string) {
    // 1. Fetch historical metrics (e.g., last 30 days)
    const metrics = await this.qualityDashboardService.getMetrics({
      project_id: projectId,
      period: '30d',
      limit: 30, // Get daily history if possible, or just latest
    });

    // 2. Run detection algorithms
    const anomaliesFound = await this.runDetectionAlgorithms(projectId, metrics);

    // 3. For each anomaly, run AI analysis and save
    for (const anomaly of anomaliesFound) {
      const aiAnalysis = await this.analyzeWithAI(projectId, anomaly);

      const savedAnomaly = await this.prisma.qualityAnomaly.create({
        data: {
          type: anomaly.type,
          metric: anomaly.metric,
          severity: anomaly.severity,
          project_id: projectId,
          current_value: anomaly.values.current,
          previous_value: anomaly.values.previous,
          expected_min: anomaly.values.expected_range?.min,
          expected_max: anomaly.values.expected_range?.max,
          change_percent: anomaly.values.change_percent,
          ai_analysis: aiAnalysis as unknown as Prisma.InputJsonValue,
          status: AnomalyStatus.OPEN,
        },
      });

      // 4. Trigger notifications and emit event
      this.eventBus.emit(
        'quality.anomaly.detected',
        new QualityAnomalyDetectedEvent(
          savedAnomaly.id,
          projectId,
          savedAnomaly.metric,
          savedAnomaly.severity,
          savedAnomaly.type,
          savedAnomaly.current_value,
          savedAnomaly.previous_value || undefined,
        ),
      );

      this.dashboardGateway.broadcastQualityUpdate(projectId, {
        event: 'quality-anomaly-detected',
        anomaly: savedAnomaly,
      });

      // Log decision
      await this.aiDecisionLogger.logDecision({
        agentName: 'AnomalyDetectionService',
        action: 'anomaly_detected',
        reasoning: `Detected ${anomaly.type} in ${anomaly.metric} for project ${projectId}`,
        ticketId: 'system',
        inputData: anomaly as unknown as Record<string, unknown>,
        outputData: aiAnalysis as unknown as Record<string, unknown>,
        confidence: aiAnalysis.confidence,
      });
    }
  }

  private async runDetectionAlgorithms(
    projectId: string,
    metrics: QualityMetricsResponseDto,
  ): Promise<DetectedAnomaly[]> {
    const anomalies: DetectedAnomaly[] = [];
    const item: MetricItemDto | undefined = metrics.items[0];
    if (!item) return [];

    const currentMetrics = item.metrics;

    // Fetch historical QA data from last 30 days for statistical baseline
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const historicalResults = await this.prisma.qAResult.findMany({
      where: {
        execution: {
          ticket: { project_id: projectId },
        },
        created_at: { gte: thirtyDaysAgo },
      },
      select: {
        test_coverage: true,
        tests_passed: true,
        overall_passed: true,
        created_at: true,
      },
      orderBy: { created_at: 'desc' },
      take: 30,
    });

    // Calculate historical averages and thresholds
    const historicalPassRates = historicalResults
      .filter((r) => r.tests_passed !== null)
      .map((r) => (r.overall_passed ? 100 : 0));

    const avgPassRate =
      historicalPassRates.length > 0
        ? historicalPassRates.reduce((a, b) => a + b, 0 as number) / historicalPassRates.length
        : 85; // Fallback default

    const historicalCoverage = historicalResults
      .filter((r) => r.test_coverage !== null)
      .map((r) => r.test_coverage as number);

    const avgCoverage =
      historicalCoverage.length > 0
        ? historicalCoverage.reduce((a, b) => a + b, 0) / historicalCoverage.length
        : 75; // Fallback default

    // Fetch historical bug escapes
    const historicalBugEscapes = await this.prisma.bugEscape.findMany({
      where: {
        ticket: { project_id: projectId },
        detected_at: { gte: thirtyDaysAgo },
      },
      select: { detected_at: true },
    });

    const avgBugEscapesPerWeek = (historicalBugEscapes.length / 30) * 7;

    // Load config thresholds
    const config = await this.getAnomalyConfig(projectId);
    const testPassRateThreshold = config.thresholds?.[AnomalyMetric.TEST_PASS_RATE];
    const coverageThreshold = config.thresholds?.[AnomalyMetric.TEST_COVERAGE];
    const bugEscapeThreshold = config.thresholds?.[AnomalyMetric.BUG_ESCAPE_RATE];

    // Detection 1: Sudden Drop in Test Pass Rate
    const passRateDropPercent = testPassRateThreshold?.sudden_drop_percent ?? 15;
    const passRateMin = testPassRateThreshold?.absolute_min ?? 80;

    if (
      currentMetrics.qa_pass_rate_percent < avgPassRate - passRateDropPercent ||
      currentMetrics.qa_pass_rate_percent < passRateMin
    ) {
      const changePercent =
        ((currentMetrics.qa_pass_rate_percent - avgPassRate) / avgPassRate) * 100;

      anomalies.push({
        type: AnomalyType.SUDDEN_DROP,
        metric: AnomalyMetric.TEST_PASS_RATE,
        severity:
          currentMetrics.qa_pass_rate_percent < passRateMin
            ? AnomalySeverity.CRITICAL
            : AnomalySeverity.WARNING,
        values: {
          current: currentMetrics.qa_pass_rate_percent,
          previous: avgPassRate,
          change_percent: changePercent,
          expected_range: { min: passRateMin, max: 100 },
        },
      });
    }

    // Detection 2: Test Coverage Drop
    const coverageDropPercent = coverageThreshold?.sudden_drop_percent ?? 5;
    const coverageMin = coverageThreshold?.absolute_min ?? 75;

    if (
      currentMetrics.avg_coverage_percent < avgCoverage - coverageDropPercent ||
      currentMetrics.avg_coverage_percent < coverageMin
    ) {
      const changePercent =
        ((currentMetrics.avg_coverage_percent - avgCoverage) / avgCoverage) * 100;

      anomalies.push({
        type: AnomalyType.SUDDEN_DROP,
        metric: AnomalyMetric.TEST_COVERAGE,
        severity: AnomalySeverity.WARNING,
        values: {
          current: currentMetrics.avg_coverage_percent,
          previous: avgCoverage,
          change_percent: changePercent,
          expected_range: { min: coverageMin, max: 100 },
        },
      });
    }

    // Detection 3: Spike in Bug Escapes
    const bugEscapeSpikePercent = bugEscapeThreshold?.spike_percent ?? 50;
    const currentBugEscapeRate = currentMetrics.bug_escape_rate_percent;

    if (currentBugEscapeRate > avgBugEscapesPerWeek * (1 + bugEscapeSpikePercent / 100)) {
      const changePercent =
        ((currentBugEscapeRate - avgBugEscapesPerWeek) / avgBugEscapesPerWeek) * 100;

      anomalies.push({
        type: AnomalyType.SPIKE,
        metric: AnomalyMetric.BUG_ESCAPE_RATE,
        severity:
          currentBugEscapeRate > avgBugEscapesPerWeek * 2
            ? AnomalySeverity.CRITICAL
            : AnomalySeverity.WARNING,
        values: {
          current: currentBugEscapeRate,
          previous: avgBugEscapesPerWeek,
          change_percent: changePercent,
          expected_range: { min: 0, max: avgBugEscapesPerWeek },
        },
      });
    }

    return anomalies;
  }

  /**
   * AI-powered analysis of an anomaly
   */
  async analyzeWithAI(projectId: string, anomaly: DetectedAnomaly): Promise<AIAnalysisDto> {
    // Fetch recent context for the project
    const recentExecutions = await this.prisma.execution.findMany({
      where: { ticket: { project_id: projectId } },
      take: 5,
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        ai_provider: true,
        task_type: true,
        status: true,
        created_at: true,
      },
    });

    const recentDeploys = await this.prisma.deployment.findMany({
      where: {
        github_push: {
          execution_id: { in: recentExecutions.map((e) => e.id as string) },
        },
      },
      take: 5,
      orderBy: { created_at: 'desc' },
    });

    const prompt = `Analyze the following quality anomaly:

Metric: ${anomaly.metric}
Type: ${anomaly.type}
Severity: ${anomaly.severity}
Current Value: ${anomaly.values.current}
Previous Value: ${anomaly.values.previous}
Change: ${anomaly.values.change_percent}%

Recent Context:
- AI Executions: ${JSON.stringify(recentExecutions)}
- Deployments: ${JSON.stringify(recentDeploys)}

Based on the data, provide:
1. 3 most likely root causes (with reasoning)
2. 3-5 recommended actions (prioritized)
3. Confidence score (0.0-1.0)

Respond in JSON format:
{
  "possible_causes": ["cause 1", "cause 2", "cause 3"],
  "recommended_actions": ["action 1", "action 2", "action 3"],
  "confidence": 0.85
}`;

    this.logger.debug(`Calling AI for anomaly analysis on project ${projectId}`);

    try {
      // Use AI processor to generate analysis
      const aiResponse = await this.aiProcessor.generateSummary(prompt);

      // Extract analysis from AI summary
      // The AI processor returns structured data, extract from summary
      const summaryText = aiResponse.summary;

      // Try to parse JSON from summary if present, otherwise use key_points
      let analysis: AIAnalysisDto;
      const jsonMatch = summaryText.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        analysis = JSON.parse(jsonMatch[0]) as AIAnalysisDto;
      } else {
        // Fallback: construct from key_points and decisions
        analysis = {
          possible_causes: aiResponse.key_points.slice(0, 3),
          recommended_actions: aiResponse.decisions.concat(aiResponse.next_steps).slice(0, 5),
          confidence: 0.75,
        };
      }

      // Validate response structure
      if (
        !analysis.possible_causes ||
        !Array.isArray(analysis.possible_causes) ||
        !analysis.recommended_actions ||
        !Array.isArray(analysis.recommended_actions) ||
        typeof analysis.confidence !== 'number'
      ) {
        throw new Error('AI response missing required fields');
      }

      // Log the AI decision for audit trail
      await this.aiDecisionLogger.logDecision({
        agentName: 'AnomalyDetectionService',
        action: 'ai_anomaly_analysis',
        reasoning: `Analyzed ${anomaly.type} in ${anomaly.metric}`,
        ticketId: projectId,
        inputData: { anomaly, prompt } as unknown as Record<string, unknown>,
        outputData: analysis as unknown as Record<string, unknown>,
        confidence: analysis.confidence,
      });

      return analysis;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`AI Analysis failed: ${message}`);

      // Fallback to rule-based analysis
      return this.getFallbackAnalysis(anomaly);
    }
  }

  private getFallbackAnalysis(anomaly: DetectedAnomaly): AIAnalysisDto {
    // Rule-based fallback when AI is unavailable
    const causes: string[] = [];
    const actions: string[] = [];

    if (
      anomaly.metric === AnomalyMetric.TEST_PASS_RATE &&
      anomaly.type === AnomalyType.SUDDEN_DROP
    ) {
      causes.push('Recent code changes may have introduced failing tests');
      causes.push('AI provider change could have affected test generation quality');
      actions.push('Review recent commits for test failures');
      actions.push('Check AI routing logs for provider changes');
    }

    if (anomaly.metric === AnomalyMetric.BUG_ESCAPE_RATE && anomaly.type === AnomalyType.SPIKE) {
      causes.push('Quality gate thresholds may be too lenient');
      causes.push('Sampling rate for QA review may have been reduced');
      actions.push('Increase QA sampling rate to 100% temporarily');
      actions.push('Review and tighten quality gate configurations');
    }

    // Generic fallback
    if (causes.length === 0) {
      causes.push('Data trend indicates deviation from baseline');
      causes.push('Investigate recent system configuration changes');
      actions.push('Manual investigation required');
      actions.push('Review historical data for patterns');
    }

    return {
      possible_causes: causes.slice(0, 3),
      recommended_actions: actions.slice(0, 5),
      confidence: 0.5, // Low confidence for fallback
    };
  }

  /**
   * Resolve or acknowledge an anomaly
   */
  async resolveAnomaly(
    id: string,
    update: AnomalyResolutionDto,
    userId: string,
  ): Promise<AnomalyDto> {
    const anomaly = await this.prisma.qualityAnomaly.findUnique({ where: { id } });
    if (!anomaly) throw new NotFoundException('Anomaly not found');

    const updated = await this.prisma.qualityAnomaly.update({
      where: { id },
      data: {
        status: update.status,
        resolution_notes: update.notes,
        resolved_at: update.status === AnomalyStatus.RESOLVED ? new Date() : undefined,
        resolved_by: update.status === AnomalyStatus.RESOLVED ? userId : undefined,
      },
    });

    // Fetch project name for DTO
    const project = await this.prisma.project.findUnique({
      where: { id: updated.project_id },
      select: { name: true },
    });

    return {
      id: updated.id,
      type: updated.type as AnomalyType,
      metric: updated.metric as AnomalyMetric,
      severity: updated.severity as AnomalySeverity,
      project_id: updated.project_id,
      project_name: project?.name || 'Unknown',
      detected_at: updated.detected_at,
      values: {
        current: updated.current_value,
        previous: updated.previous_value || undefined,
        change_percent: updated.change_percent || undefined,
      },
      ai_analysis: updated.ai_analysis as unknown as AIAnalysisDto,
      status: updated.status as AnomalyStatus,
      resolution: updated.resolved_at
        ? {
            resolved_at: updated.resolved_at,
            resolved_by: updated.resolved_by || 'Unknown',
            notes: updated.resolution_notes || '',
          }
        : undefined,
    };
  }

  /**
   * Get configuration for a project or global default
   */
  async getAnomalyConfig(projectId?: string): Promise<AnomalyConfigDto> {
    const config = await this.prisma.qualityAnomalyConfig.findFirst({
      where: { project_id: projectId || null },
    });

    if (!config) {
      // Default fallback if not even global is set
      return {
        project_id: projectId,
        thresholds: {
          [AnomalyMetric.TEST_PASS_RATE]: { sudden_drop_percent: 15, absolute_min: 80 },
          [AnomalyMetric.TEST_COVERAGE]: { sudden_drop_percent: 5, absolute_min: 75 },
          [AnomalyMetric.BUG_ESCAPE_RATE]: { spike_percent: 10, absolute_min: 5 },
          [AnomalyMetric.SECURITY_VULNERABILITIES]: { spike_percent: 0, absolute_min: 0 },
        },
        notifications_enabled: true,
      };
    }

    return {
      project_id: config.project_id === null ? undefined : config.project_id,
      thresholds: config.thresholds as unknown as AnomalyConfigDto['thresholds'],
      notifications_enabled: config.notifications_enabled,
      slack_channels: config.slack_channels,
      email_recipients: config.email_recipients,
    };
  }

  /**
   * Update configuration
   */
  async updateAnomalyConfig(update: AnomalyConfigDto, userId: string): Promise<AnomalyConfigDto> {
    const { project_id, thresholds, notifications_enabled, slack_channels, email_recipients } =
      update;

    const saved = await this.prisma.qualityAnomalyConfig.upsert({
      where: { project_id: (project_id === undefined ? null : project_id) as unknown as string },
      update: {
        thresholds: thresholds as unknown as Prisma.InputJsonValue,
        notifications_enabled,
        slack_channels,
        email_recipients,
        updated_by: userId,
      },
      create: {
        project_id: (project_id === undefined ? null : project_id) as unknown as string,
        thresholds: thresholds as unknown as Prisma.InputJsonValue,
        notifications_enabled: notifications_enabled ?? true,
        slack_channels: slack_channels || [],
        email_recipients: email_recipients || [],
        updated_by: userId,
      },
    });

    return {
      project_id: saved.project_id === null ? undefined : saved.project_id,
      thresholds: saved.thresholds as unknown as AnomalyConfigDto['thresholds'],
      notifications_enabled: saved.notifications_enabled,
      slack_channels: saved.slack_channels,
      email_recipients: saved.email_recipients,
    };
  }

  /**
   * Get historical anomaly data and trends (AC#6)
   */
  async getAnomalyHistory(projectId?: string, metric?: string, period: string = '30d') {
    // Parse period (e.g., "30d", "7d", "90d")
    const days = parseInt(period.replace('d', ''), 10) || 30;
    const startDate = new Date();
    startDate.setDate(startDate.setDate(startDate.getDate() - days));

    const where: Record<string, unknown> = {
      detected_at: { gte: startDate },
    };
    if (projectId) where.project_id = projectId;
    if (metric) where.metric = metric;

    const anomalies = await this.prisma.qualityAnomaly.findMany({
      where,
      orderBy: { detected_at: 'asc' },
    });

    // Aggregate by metric and type
    const summary = anomalies.reduce(
      (acc, a) => {
        const metricKey = a.metric;
        // eslint-disable-next-line security/detect-object-injection
        if (!acc.by_metric[metricKey]) {
          // eslint-disable-next-line security/detect-object-injection
          acc.by_metric[metricKey] = { count: 0, critical: 0, warning: 0, resolved: 0 };
        }
        // eslint-disable-next-line security/detect-object-injection
        acc.by_metric[metricKey].count++;
        // eslint-disable-next-line security/detect-object-injection
        if (a.severity === 'critical') acc.by_metric[metricKey].critical++;
        // eslint-disable-next-line security/detect-object-injection
        if (a.severity === 'warning') acc.by_metric[metricKey].warning++;
        // eslint-disable-next-line security/detect-object-injection
        if (a.status === 'resolved') acc.by_metric[metricKey].resolved++;

        return acc;
      },
      {
        by_metric: {} as Record<
          string,
          { count: number; critical: number; warning: number; resolved: number }
        >,
      },
    );

    return {
      period,
      total_anomalies: anomalies.length,
      summary: summary.by_metric,
      timeline: anomalies.map((a) => ({
        date: a.detected_at,
        metric: a.metric,
        type: a.type,
        severity: a.severity,
        status: a.status,
      })),
    };
  }
}
