import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { AuditLogService } from '@/common/audit/audit-log.service';
import { MetricsService } from '@/common/metrics/metrics.service';
import { AIExecutionService } from '@/ai-routing/ai-execution.service';
import { PromptGeneratorService } from '@/ai-routing/prompt-generator.service';
import { AIDecisionLoggerService } from '@/audit/ai-decision-logger.service';
import { GitHubService } from '../github.service';
import { PRRiskLevel } from '@/prisma/client';
import { IAIPromptExecutor } from '@/ai-routing/interfaces';
import { WorkspaceService } from '@/ai-routing/providers';

export interface RiskAssessmentResult {
  riskLevel: PRRiskLevel;
  reasoning: string;
  mergeRecommendation: string;
}

@Injectable()
export class PRRiskAssessorService {
  private readonly logger = new Logger(PRRiskAssessorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly metrics: MetricsService,
    private readonly aiExecution: AIExecutionService,
    private readonly promptGenerator: PromptGeneratorService,
    private readonly aiDecisionLogger: AIDecisionLoggerService,
    private readonly github: GitHubService,
    private readonly workspaceService: WorkspaceService,
  ) {}

  /**
   * Assess the risk level of a Pull Request
   */
  async assess(
    executionId: string,
    repository: string,
    prNumber: number,
    correlationId?: string,
  ): Promise<RiskAssessmentResult> {
    this.logger.log(`Starting PR risk assessment for ${repository}#${prNumber}`, {
      executionId,
      correlationId,
    });

    try {
      // 1. Fetch PR diff
      const diff = await this.github.getPullRequestDiff(repository, prNumber);

      // 2. Fetch execution context with ticket and context documents
      const execution = await this.prisma.execution.findUnique({
        where: { id: executionId },
        include: {
          ticket: {
            include: {
              context_documents: true,
            },
          },
        },
      });

      if (!execution) {
        throw new Error(`Execution ${executionId} not found`);
      }

      // 3. Get workspace path
      const workspace = await this.workspaceService.getWorkspace(executionId);
      if (!workspace) {
        throw new Error(`Workspace not found for execution ${executionId}`);
      }

      // 4. Build prompt via centralized service (AC#7)
      // Combine ticket info and context document summaries (H2)
      const contextDocs = execution.ticket.context_documents
        .map(
          (doc) =>
            `- ${doc.original_filename}: ${doc.content_summary || doc.extracted_text?.substring(0, 500)}`,
        )
        .join('\n');

      const prompt = this.promptGenerator.generateRiskAssessmentPrompt({
        ticketId: execution.ticket.clickup_task_id,
        ticketTitle: execution.ticket.title,
        ticketDescription: `${execution.ticket.description}\n\nRELEVANT CONTEXT DOCUMENTS:\n${contextDocs}`,
        diff,
      });

      // 5. Execute via AI - Safe Provider Access (C1 Fix)
      const providerInstance = this.aiExecution.getProvider(execution.ai_provider);
      if (!providerInstance) {
        throw new Error(`Provider ${execution.ai_provider} not available`);
      }

      const aiProvider = providerInstance as unknown as IAIPromptExecutor;
      const result = await aiProvider.executePrompt({
        workspacePath: workspace.path,
        prompt,
      });

      if (!result.success || !result.response) {
        throw new Error(
          `AI provider failed: ${result.error?.message || result.error ? JSON.stringify(result.error) : 'No response'}`,
        );
      }

      // 6. Parse response
      const assessment = this.parseRiskResponse(result.response);

      // 7. Store results
      await this.prisma.execution.update({
        where: { id: executionId },
        data: {
          risk_level: assessment.riskLevel,
        },
      });

      // 8. Log decision
      await this.aiDecisionLogger.logDecision({
        agentName: 'PRRiskAssessor',
        action: 'risk_assessment',
        reasoning: assessment.reasoning,
        ticketId: execution.ticket.id,
        executionId,
        inputData: { repository, prNumber, diffLength: diff.length },
        outputData: {
          riskLevel: assessment.riskLevel,
          recommendation: assessment.mergeRecommendation,
        },
        confidence: 0.85,
      });

      // 9. Record metrics
      this.metrics.incrementCounter('pr_risk_level_total', {
        risk_level: assessment.riskLevel,
        repository,
      });

      return assessment;
    } catch (_error) {
      this.logger.error(`PR risk assessment failed for ${repository}#${prNumber}`, {
        error: (_error as Error).message,
        executionId,
      });
      throw _error;
    }
  }

  private parseRiskResponse(response: string): RiskAssessmentResult {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          riskLevel: parsed.riskLevel as PRRiskLevel,
          reasoning: parsed.reasoning,
          mergeRecommendation: parsed.mergeRecommendation,
        };
      }
      throw new Error('Could not parse risk assessment response');
    } catch (_error) {
      throw new Error(`Failed to parse risk assessment: ${(_error as Error).message}`);
    }
  }
}
