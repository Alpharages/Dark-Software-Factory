import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service'; // Fixed import path
import { OrchestratorService } from '../../ai-routing/orchestrator.service';
import { GitHubService } from '../../github/github.service';
import { QaResultsService } from '../qa-results.service';
import { AIDecisionLoggerService } from '@/audit/ai-decision-logger.service';
import {
  AiCodeReviewResponseDto,
  AiCodeReviewRiskLevel,
  AiFindingsCollectionDto,
} from '../dto/ai-code-review.dto';
import { UpdateFindingStatusDto } from '../dto/update-finding-status.dto';
import { CODE_REVIEW_INSTRUCTION } from '../templates/code-review-instruction.template';
import { AIProvider, Prisma } from '@/prisma/client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter, Histogram } from 'prom-client';
import { QA_METRICS } from '../../common/metrics/metrics.constants'; // Added QA_METRICS
import * as crypto from 'crypto';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';

@Injectable()
export class AiCodeReviewService {
  private readonly logger = new Logger(AiCodeReviewService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly orchestrator: OrchestratorService,
    private readonly githubService: GitHubService,
    private readonly qaResultsService: QaResultsService,
    private readonly decisionLogger: AIDecisionLoggerService,
    @InjectMetric(QA_METRICS.AI_REVIEW_GENERATION_TOTAL)
    private readonly generationTotal: Counter<string>,
    @InjectMetric(QA_METRICS.AI_REVIEW_GENERATION_DURATION)
    private readonly generationDuration: Histogram<string>,
    @InjectMetric(QA_METRICS.AI_REVIEW_FINDINGS_TOTAL)
    private readonly findingsTotal: Counter<string>,
    @InjectMetric(QA_METRICS.AI_REVIEW_FINDING_STATUS_UPDATES)
    private readonly statusUpdatesTotal: Counter<string>,
  ) {}

  /**
   * Generate an AI code review for a given queue item.
   * Checks cache first. If missing, gathers context and triggers AI.
   */
  async generateReview(queueItemId: string, forced = false): Promise<AiCodeReviewResponseDto> {
    const start = Date.now();
    this.logger.log(`Generating AI review for queue item ${queueItemId} (forced: ${forced})`);

    // 1. Fetch Queue Item & Context
    const queueItem = await this.prisma.qaReviewQueue.findUnique({
      where: { id: queueItemId },
      include: {
        execution: {
          include: {
            ticket: true,
          },
        },
      },
    });

    if (!queueItem) {
      throw new NotFoundException(`Queue item ${queueItemId} not found`);
    }

    // 2. Check Cache (unless forced)
    if (!forced) {
      const cachedReview = await this.prisma.aiCodeReview.findFirst({
        where: {
          queue_item_id: queueItemId,
          review_version: 1, // Simple versioning for now
          expires_at: { gt: new Date() },
        },
        include: { finding_statuses: true }, // Not fully hydrated DTO but simplified check
      });

      if (cachedReview) {
        this.logger.log(`Returning cached review for ${queueItemId}`);
        return this.mapToDto(cachedReview);
      }
    }

    // 3. Gather Context
    // 3a. QA Results
    const qaResult = await this.qaResultsService.findByExecutionId(queueItem.execution_id);

    // 3b. GitHub Diff
    // We need to find the PR details. Usually linked via queueItem.pr_id or related models.
    // Fallback to searching GitHubPush linked to execution if pr_url missing
    let repoName = '';
    let prNumber = 0;

    if (queueItem.pr_url) {
      // Parse URL: https://github.com/owner/repo/pull/123
      const match = queueItem.pr_url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
      if (match) {
        repoName = match[2]; // or full owner/repo? GitHubService usually expects 'owner/repo' or just repo if owner configured
        const owner = match[1];
        repoName = `${owner}/${match[2]}`;
        prNumber = parseInt(match[3], 10);
      }
    }

    // If parsing failed, try to look up GitHubPush
    if (!repoName || !prNumber) {
      const ghPush = await this.prisma.gitHubPush.findFirst({
        where: { execution_id: queueItem.execution_id },
      });
      if (ghPush && ghPush.pr_number) {
        repoName = ghPush.repository; // Assumed to be 'owner/repo'
        prNumber = ghPush.pr_number;
      }
    }

    if (!repoName || !prNumber) {
      throw new BadRequestException('Could not determine PR details for code review');
    }

    let diff = '';
    try {
      diff = await this.githubService.getPullRequestDiff(repoName, prNumber);
      // Truncate diff if too large (Safety)
      const maxLines = this.configService.get('AI_REVIEW_MAX_DIFF_LINES') || 1000;
      const lines = diff.split('\n');
      if (lines.length > maxLines) {
        diff = lines.slice(0, maxLines).join('\n') + '\n...(truncated due to size)...';
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to fetch PR diff: ${errorMessage}`);
      throw new InternalServerErrorException('Failed to fetch PR content');
    }

    // 4. Construct Prompt
    const prompt = CODE_REVIEW_INSTRUCTION.replace(
      '{ticket_title}',
      queueItem.execution.ticket.title,
    )
      .replace('{acceptance_criteria}', queueItem.execution.ticket.acceptance_criteria)
      .replace('{ai_provider}', queueItem.execution.ai_provider)
      .replace('{complexity_score}', queueItem.execution.complexity_score?.toString() || 'N/A')
      .replace('{linting_summary}', qaResult.linting_passed ? 'PASSED' : 'FAILED')
      .replace('{test_summary}', qaResult.tests_passed ? 'PASSED' : 'FAILED')
      .replace('{coverage_summary}', `${qaResult.test_coverage}%`)
      .replace('{security_summary}', 'See Security Scan Results') // Simplified
      .replace('{pr_diff_content}', diff)
      .replace('{json_schema}', JSON.stringify(new AiFindingsCollectionDto())); // Hint structure

    // 5. Call Orchestrator
    const result = await this.orchestrator.executeTask({
      correlationId: queueItemId,
      ticketId: queueItem.execution.ticket.id,
      prompt: prompt,
      agentName: 'AiCodeReview',
      action: 'Review Generation',
      providerOverride: queueItem.execution.ai_provider as AIProvider,
    });

    if (!result.success) {
      throw new InternalServerErrorException('AI Code Review generation failed');
    }

    // 6. Parse and Persist
    let findingsData: AiFindingsCollectionDto;
    try {
      // Clean markdown blocks if present
      const cleanJson = result.output
        .replace(/```json/g, '')
        .replace(/```/g, '')
        .trim();
      const rawData = JSON.parse(cleanJson);

      // Class-Validator Validation
      findingsData = plainToInstance(AiFindingsCollectionDto, rawData);
      const errors = await validate(findingsData);

      if (errors.length > 0) {
        throw new Error('Validation failed: ' + errors.map((e) => e.toString()).join(', '));
      }
    } catch (e) {
      this.logger.error('Failed to parse or validate AI response', e);
      throw new InternalServerErrorException(
        'Invalid AI response format: ' + (e instanceof Error ? e.message : String(e)),
      );
    }

    // Determine Overall Risk/Assessment
    // Simple logic: If any HIGH severity or security note -> HIGH_RISK
    let risk = AiCodeReviewRiskLevel.LOW_RISK;
    const hasHighSev = [...findingsData.missed_issues, ...findingsData.security_notes].some(
      (f) => f.severity === 'HIGH',
    );

    if (hasHighSev) risk = AiCodeReviewRiskLevel.HIGH_RISK;
    else if (findingsData.complex_logic.length > 0) risk = AiCodeReviewRiskLevel.MODERATE_RISK;

    const savedReview = await this.prisma.aiCodeReview.create({
      data: {
        queue_item_id: queueItemId,
        ai_model: result.metadata?.model || 'unknown',
        confidence_score: 0.85, // Placeholder or from result
        overall_assessment: risk,
        summary: `Automated review generated via ${result.metadata?.provider || 'AI'}. Found ${findingsData.missed_issues.length} potential issues.`,
        findings: findingsData as unknown as Prisma.InputJsonValue, // Cast to Json
        generation_duration_ms: Date.now() - start,
        cost_usd: result.metadata?.cost || 0,
        cache_key: this.generateCacheKey(queueItemId, 1),
        expires_at: new Date(
          Date.now() + (this.configService.get('AI_CACHE_TTL_SECONDS') || 3600) * 1000,
        ),

        // Create Findings relations
        finding_statuses: {
          create: this.mapFindingsToDb(findingsData),
        },
      },
      include: { finding_statuses: true },
    });

    // Log Decision (Audit Trail)
    await this.decisionLogger.logDecision({
      agentName: 'AiCodeReview',
      action: 'generate_review',
      reasoning: `Generated review for execution ${queueItem.execution_id}. Risk assessed as ${risk}.`,
      ticketId: queueItem.execution.ticket.id,
      executionId: queueItem.execution.id,
      inputData: {
        pr_url: queueItem.pr_url,
        diff_length: diff.length,
        qa_results: {
          lint: qaResult.linting_passed,
          tests: qaResult.tests_passed,
        },
      },
      outputData: {
        risk_level: risk,
        findings_count: findingsData.missed_issues.length + findingsData.security_notes.length,
        review_id: savedReview.id,
      },
      confidence: Number(savedReview.confidence_score),
    });

    // Metrics
    this.generationTotal.inc({ risk_level: risk });
    this.generationDuration.observe((Date.now() - start) / 1000);
    this.findingsTotal.inc(findingsData.missed_issues.length + findingsData.security_notes.length);

    return this.mapToDto(savedReview);
  }

  /**
   * Update the status of a specific finding (ACKNOWLEDGED, FIXED, etc.)
   */
  async updateFindingStatus(findingId: string, dto: UpdateFindingStatusDto, userId: string) {
    const finding = await this.prisma.aiCodeReviewFinding.update({
      where: { id: findingId },
      data: {
        status: dto.status,
        review_notes: dto.review_notes,
        reviewed_by: userId,
        reviewed_at: new Date(),
      },
    });

    this.statusUpdatesTotal.inc({ status: dto.status });
    return finding;
  }

  // --- Helpers ---

  private generateCacheKey(queueId: string, version: number): string {
    return crypto.createHash('sha256').update(`${queueId}-v${version}`).digest('hex');
  }

  private mapFindingsToDb(
    data: AiFindingsCollectionDto,
  ): Prisma.AiCodeReviewFindingCreateWithoutAi_reviewInput[] {
    const allFindings: Prisma.AiCodeReviewFindingCreateWithoutAi_reviewInput[] = [];

    // Helper to map
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const map = (items: any[], type: string) => {
      items.forEach((item) => {
        allFindings.push({
          finding_key: crypto
            .createHash('md5')
            .update(`${item.file}-${item.line || 0}-${item.description}`)
            .digest('hex'),
          finding_type: type,
          severity: item.severity || 'MEDIUM', // Default
          file_path: item.file,
          line_number: item.line || 0,
          description: item.description,
          suggestion: item.suggestion || item.refactoring_suggestion || item.note,
          status: 'PENDING',
        });
      });
    };

    map(data.missed_issues, 'missed_issue');
    map(data.code_smells, 'code_smell');
    map(data.complex_logic, 'complex_logic');
    map(data.testing_gaps, 'testing_gap');
    map(data.security_notes, 'security_note');

    return allFindings;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mapToDto(model: any): AiCodeReviewResponseDto {
    return {
      queue_item_id: model.queue_item_id,
      review_version: model.review_version,
      generated_at: model.generated_at.toISOString(),
      ai_model: model.ai_model,
      confidence_score: Number(model.confidence_score),
      overall_assessment: model.overall_assessment as AiCodeReviewRiskLevel,
      summary: model.summary,
      findings: model.findings as AiFindingsCollectionDto,
      generation_duration_ms: model.generation_duration_ms,
      cost_usd: Number(model.cost_usd),
      review_time_estimate: this.calculateTimeEstimate(model.findings as AiFindingsCollectionDto),
    };
  }

  private calculateTimeEstimate(findings: AiFindingsCollectionDto): string {
    // Estimate: 2 mins per finding, 1 min per complexity point (if available) - simplified
    const totalFindings =
      findings.missed_issues.length +
      findings.code_smells.length +
      findings.complex_logic.length +
      findings.testing_gaps.length +
      findings.security_notes.length;

    // Base time: 5 mins
    const minutes = 5 + totalFindings * 2;

    // Cap at reasonable max for UI display (e.g. "60+ minutes")
    if (minutes > 60) return '60+ minutes';
    return `${minutes} minutes`;
  }
}
