import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AIProvider } from '@/prisma/client';
import { Counter, Histogram } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import {
  IPromptBuilder,
  IPromptGenerationInput,
  IProjectContext,
  IGeneratedPrompt,
  IPromptMetadata,
  PromptSection,
} from './interfaces';
import { CursorPromptBuilder } from './prompt-templates/cursor-prompt.template';
import { ClaudeCodePromptBuilder } from './prompt-templates/claude-prompt.template';
import { ArchitectureConstraintsService } from '@/architecture-review/architecture-constraints.service';

/**
 * Prompt Generator Service
 *
 * FR61: System converts ticket requirements to AI-executable prompts
 *
 * Features:
 * - Provider-specific prompt optimization
 * - Token estimation and truncation
 * - Metrics tracking for prompt quality
 * - Project context enrichment
 */
@Injectable()
export class PromptGeneratorService implements OnModuleInit {
  private readonly logger = new Logger(PromptGeneratorService.name);

  /** Map of provider to prompt builder */
  private readonly builders: Map<AIProvider, IPromptBuilder> = new Map();

  constructor(
    private readonly cursorBuilder: CursorPromptBuilder,
    private readonly claudeBuilder: ClaudeCodePromptBuilder,
    @InjectMetric('prompt_generation_total')
    private readonly promptCounter: Counter<string>,
    @InjectMetric('prompt_tokens_histogram')
    private readonly tokenHistogram: Histogram<string>,
    @InjectMetric('prompt_generation_duration_seconds')
    private readonly durationHistogram: Histogram<string>,
    private readonly architectureConstraintsService: ArchitectureConstraintsService,
  ) {}

  onModuleInit(): void {
    // Register prompt builders
    this.builders.set(AIProvider.CURSOR_HEADLESS, this.cursorBuilder);
    this.builders.set(AIProvider.CLAUDE_CODE, this.claudeBuilder);

    this.logger.log(
      `Prompt generators initialized for providers: ${[...this.builders.keys()].join(', ')}`,
    );
  }

  /**
   * Generate AI-executable prompt for a ticket
   *
   * @param input - Routing result from Story 2.3
   * @param context - Optional project context for enrichment
   * @returns Generated prompt with metadata
   */
  async generatePrompt(
    input: IPromptGenerationInput,
    context?: IProjectContext,
  ): Promise<IGeneratedPrompt> {
    const { correlationId, provider, ticketId } = input;
    const endTimer = this.durationHistogram.startTimer({ provider });

    this.logger.log(`[${correlationId}] Generating ${provider} prompt for ticket ${ticketId}`);

    try {
      // 1. Enrich context with architecture constraints
      if (!context) {
        context = this.getDefaultProjectContext();
      }

      try {
        // Fetch all applicable constraints (Global + Project specific if applicable)
        // findAll logic: if projectId provided, it fetches specific + global. If not, just global.
        const constraints = input.projectId
          ? await this.architectureConstraintsService.findAll(input.projectId)
          : await this.architectureConstraintsService.findAll();

        if (constraints.length > 0) {
          context.architectureConstraints = constraints.map(
            (c: { type: string; rules: unknown; scope: string }) => {
              const rulesStr = JSON.stringify(c.rules);
              return `${c.type}: ${rulesStr} (${c.scope})`;
            },
          );
        }
      } catch (err) {
        this.logger.warn(`Failed to fetch architecture constraints: ${(err as Error).message}`);
      }

      // Story 7.6 AC#5: Fetch TL guidance from previous escalations for this ticket
      if (input.ticketId) {
        try {
          // Query ADR table for most recent GUIDANCE_PROVIDED or RESOLVED ADR for this ticket
          const adrsWithGuidance = await this.architectureConstraintsService[
            'prisma'
          ].adr.findFirst({
            where: {
              ticket_id: input.ticketId,
              status: { in: ['GUIDANCE_PROVIDED', 'RESOLVED'] },
              tl_guidance: { not: null },
            },
            orderBy: { guidance_provided_at: 'desc' },
            select: { tl_guidance: true },
          });

          if (adrsWithGuidance?.tl_guidance) {
            context.previousEscalationGuidance = adrsWithGuidance.tl_guidance;
            this.logger.log(
              `[${correlationId}] Injecting TL guidance into prompt for ticket ${input.ticketId}`,
            );
          }
        } catch (err) {
          this.logger.warn(
            `Failed to fetch TL guidance for ticket ${input.ticketId}: ${(err as Error).message}`,
          );
        }
      }

      // 2. Get appropriate builder
      const builder = this.getBuilder(provider);

      // 2. Build the prompt (with explicit error handling)
      let prompt: string;
      try {
        prompt = builder.build(input, context);
      } catch (buildError: unknown) {
        const err = buildError as Error;
        this.logger.error(
          `[${correlationId}] Failed to build prompt for ${provider}: ${err.message}`,
        );
        throw new Error(`Prompt generation failed: ${err.message}`);
      }

      // 3. Truncate if needed
      const originalLength = prompt.length;
      prompt = builder.truncateIfNeeded(prompt);
      const wasTruncated = prompt.length < originalLength;

      if (wasTruncated) {
        this.logger.warn(
          `[${correlationId}] Prompt truncated from ${originalLength} to ${prompt.length} chars`,
        );
      }

      // 4. Calculate metadata
      const metadata = this.buildMetadata(prompt, builder, context, wasTruncated);

      // 5. Track metrics
      this.trackMetrics(provider, metadata);

      // 6. Build result
      const result: IGeneratedPrompt = {
        correlationId,
        ticketId,
        provider,
        prompt,
        metadata,
      };

      this.logger.log(
        `[${correlationId}] Prompt generated: ${metadata.promptLength} chars, ` +
          `~${metadata.estimatedTokens} tokens, ${metadata.sectionsIncluded.length} sections`,
      );

      return result;
    } catch (error: unknown) {
      // Catch errors from getBuilder or other unhandled exceptions
      const err = error as Error;
      this.logger.error(
        `[${correlationId}] Error generating prompt for ${provider}: ${err.message}`,
      );
      throw error;
    } finally {
      endTimer();
    }
  }

  /**
   * Generate prompt and return just the prompt string
   * Convenience method for simple cases
   */
  async generatePromptString(
    input: IPromptGenerationInput,
    context?: IProjectContext,
  ): Promise<string> {
    const result = await this.generatePrompt(input, context);
    return result.prompt;
  }

  /**
   * Generate specialized prompt for PR risk assessment (Story 14.1 AC#7)
   */
  generateRiskAssessmentPrompt(context: {
    ticketId: string;
    ticketTitle: string;
    ticketDescription?: string;
    diff: string;
  }): string {
    return `You are a senior security and infrastructure engineer. Analyze the following Pull Request diff for risk.

CORE PROJECT CONTEXT:
- Tech Stack: TypeScript, NestJS, Prisma, PostgreSQL, RabbitMQ
- Critical Paths: src/auth/*, src/database/*, prisma/schema.prisma, src/config/*

TICKET CONTEXT:
- Ticket: [${context.ticketId}] ${context.ticketTitle}
- Description: ${context.ticketDescription || 'N/A'}

PR DIFF:
\`\`\`diff
${context.diff}
\`\`\`

RISK FACTORS TO CONSIDER:
1. Files changed in core directories (e.g., config, auth, database, security).
2. Large diff size or many unrelated changes.
3. Breaking changes to public APIs or database schema.
4. Security-sensitive changes (secrets handling, permissions, encryption).
5. Complexity of logic changes.

RISK LEVELS:
- LOW: Routine changes, low impact potential.
- MEDIUM: Moderate changes, standard review required.
- HIGH: Significant changes to critical components.
- CRITICAL: Dangerous changes, high risk of regression or security issue.

REQUIRED OUTPUT FORMAT (JSON):
{
  "riskLevel": "LOW | MEDIUM | HIGH | CRITICAL",
  "reasoning": "Detailed technical explanation of risk factors identified",
  "mergeRecommendation": "PROCEED | CAUTION | BLOCKED"
}

Analyze the diff and return ONLY the JSON response.`;
  }

  /**
   * Get builder for provider
   */
  private getBuilder(provider: AIProvider): IPromptBuilder {
    const builder = this.builders.get(provider);

    if (!builder) {
      throw new Error(`No prompt builder registered for provider: ${provider}`);
    }

    return builder;
  }

  /**
   * Build prompt metadata
   */
  private buildMetadata(
    prompt: string,
    builder: IPromptBuilder,
    context?: IProjectContext,
    _wasTruncated?: boolean,
  ): IPromptMetadata {
    // Detect which sections are included
    const sectionsIncluded: string[] = [];

    if (prompt.includes('# Task:') || prompt.includes('## Task:')) {
      sectionsIncluded.push(PromptSection.TASK_TITLE);
    }
    if (prompt.includes('## Description')) {
      sectionsIncluded.push(PromptSection.DESCRIPTION);
    }
    if (prompt.includes('## Acceptance Criteria')) {
      sectionsIncluded.push(PromptSection.ACCEPTANCE_CRITERIA);
    }
    if (prompt.includes('## Technical Requirements')) {
      sectionsIncluded.push(PromptSection.TECHNICAL_REQUIREMENTS);
    }
    if (prompt.includes('## Project Context')) {
      sectionsIncluded.push(PromptSection.PROJECT_CONTEXT);
    }
    if (prompt.includes('## Relevant File') || prompt.includes('File:')) {
      sectionsIncluded.push(PromptSection.RELEVANT_FILES);
    }
    if (prompt.includes('Coding Standards')) {
      sectionsIncluded.push(PromptSection.CODE_STANDARDS);
    }
    if (prompt.includes('## Output')) {
      sectionsIncluded.push(PromptSection.OUTPUT_FORMAT);
    }
    if (prompt.includes('PR RISK ASSESSMENT')) {
      sectionsIncluded.push(PromptSection.PR_RISK_ASSESSMENT);
    }

    return {
      promptLength: prompt.length,
      estimatedTokens: builder.estimateTokens(prompt),
      sectionsIncluded,
      contextFilesIncluded: prompt.includes('```typescript') && prompt.includes('// File:'),
      relevantFilesCount: context?.relevantFiles?.length || 0,
      generatedAt: new Date(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      templateVersion: (builder as any).templateVersion || '1.0.0',
    };
  }

  /**
   * Track Prometheus metrics
   */
  private trackMetrics(provider: AIProvider, metadata: IPromptMetadata): void {
    // Count prompts generated
    this.promptCounter.inc({
      provider,
      has_context: String(metadata.contextFilesIncluded),
    });

    // Track token distribution
    this.tokenHistogram.observe({ provider }, metadata.estimatedTokens);
  }

  /**
   * Get default project context
   * Called when no specific context is provided
   */
  getDefaultProjectContext(): IProjectContext {
    return {
      projectName: process.env.npm_package_name || 'Default Project',
      techStack: ['TypeScript', 'NestJS', 'Prisma', 'PostgreSQL', 'RabbitMQ'],
      codingStandards: [
        'Use TypeScript strict mode',
        'Follow NestJS conventions for modules, services, controllers',
        'Use Prisma for database operations',
        'Include JSDoc for public methods',
        'Error handling with proper HTTP exceptions',
        'Correlation IDs for request tracing',
      ],
      fileStructure: `src/
├── modules/
│   ├── ai-routing/
│   ├── ticket-intake/
│   ├── webhooks/
│   └── ...
├── common/
│   ├── decorators/
│   ├── filters/
│   ├── guards/
│   └── interceptors/
├── config/
│   ├── database/
│   └── rabbitmq/`,
      dependencies: [
        '@nestjs/core',
        '@nestjs/common',
        '@prisma/client',
        'amqplib',
        'class-validator',
        'class-transformer',
        'prom-client',
        '@willsoto/nestjs-prometheus',
      ],
      relevantFiles: [],
    };
  }
}
