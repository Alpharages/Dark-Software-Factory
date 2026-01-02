import { Injectable } from '@nestjs/common';
import { AIProvider } from '@/prisma/client';
import { IPromptBuilder, IPromptGenerationInput, IProjectContext } from '../interfaces';

/**
 * Cursor CLI Headless Prompt Builder
 *
 * Per architecture: Cursor auto-indexes repository, so we:
 * - Emphasize file paths (Cursor will fetch content)
 * - Focus on task clarity
 * - Use structured format Cursor expects
 * - No need to include file contents inline
 */
@Injectable()
export class CursorPromptBuilder implements IPromptBuilder {
  readonly provider = AIProvider.CURSOR_HEADLESS;
  readonly maxTokens = 32000; // Cursor standard context window
  readonly templateVersion = '1.0.0'; // Increment when template structure changes

  /**
   * Build Cursor-optimized prompt
   */
  build(input: IPromptGenerationInput, context?: IProjectContext): string {
    const sections: string[] = [];

    // 1. Task Title (clear and actionable)
    sections.push(this.buildTaskTitle(input));

    // 2. Task Description
    sections.push(this.buildDescription(input));

    // 3. Acceptance Criteria (executable format)
    sections.push(this.buildAcceptanceCriteria(input));

    // 4. Technical Requirements
    sections.push(this.buildTechnicalRequirements(input));

    // 5. Project Context (if available)
    if (context) {
      sections.push(this.buildProjectContext(context));
    }

    // 5.5. TL Guidance from Escalation (Story 7.6 AC#5)
    if (context?.previousEscalationGuidance) {
      sections.push(this.buildEscalationGuidance(context.previousEscalationGuidance));
    }

    // 6. Relevant Files (paths only - Cursor fetches content)
    if (context?.relevantFiles?.length) {
      sections.push(this.buildRelevantFiles(context));
    }

    // 7. Feedback from Previous Execution
    if (input.feedback) {
      sections.push(this.buildFeedback(input.feedback));
    }

    // 8. Output Format Instructions
    sections.push(this.buildOutputFormat());

    return sections.join('\n\n');
  }

  /**
   * Estimate tokens (rough approximation: 1 token ≈ 4 chars)
   *
   * Note: This is an approximation with ~20% variance. For production accuracy,
   * consider using tiktoken or similar tokenizer libraries for precise counts.
   */
  estimateTokens(prompt: string): number {
    return Math.ceil(prompt.length / 4);
  }

  /**
   * Truncate prompt if exceeds token limit
   *
   * Truncation Priority (what to remove first):
   * 1. File contents (keep paths)
   * 2. Project context details (keep tech stack essentials)
   * 3. Technical requirements (keep critical ones)
   * 4. Description (summarize if needed)
   * 5. NEVER remove: Task title, Acceptance criteria
   */
  /**
   * Truncate prompt if exceeds token limit
   *
   * Truncation Priority (what to remove first):
   * 1. Project Context (least critical for Cursor which has repo access)
   * 2. Technical Requirements (can be inferred)
   * 3. Description (summarize if needed)
   *
   * NEVER remove: Task title, Acceptance criteria, Output format
   */
  truncateIfNeeded(prompt: string): string {
    const estimated = this.estimateTokens(prompt);
    if (estimated <= this.maxTokens) {
      return prompt;
    }

    // Strategy: Remove sections from bottom priority up until it fits
    // We can't easily parse the string back to sections, so we'll use regex to find and remove sections

    let truncated = prompt;

    // 1. Remove Project Context
    if (this.estimateTokens(truncated) > this.maxTokens) {
      truncated = truncated.replace(
        /## Project Context[\s\S]*?(?=## Relevant Files|## Output Requirements|$)/,
        '',
      );
    }

    // 2. Remove Technical Requirements
    if (this.estimateTokens(truncated) > this.maxTokens) {
      truncated = truncated.replace(
        /## Technical Requirements[\s\S]*?(?=## Project Context|## Relevant Files|## Output Requirements|$)/,
        '',
      );
    }

    // 3. If still too long, fall back to aggressive truncation of the middle
    if (this.estimateTokens(truncated) > this.maxTokens) {
      const targetLength = this.maxTokens * 4;
      const keepStart = Math.floor(targetLength * 0.6);
      const keepEnd = Math.floor(targetLength * 0.3);

      truncated =
        truncated.substring(0, keepStart) +
        '\n\n... [Context truncated for brevity] ...\n\n' +
        truncated.substring(truncated.length - keepEnd);
    }

    return truncated;
  }

  private buildTaskTitle(input: IPromptGenerationInput): string {
    return `# Task: ${input.title}

**Ticket ID:** ${input.ticketId}
**ClickUp Task:** ${input.clickupTaskId}
**Complexity:** ${this.getComplexityLabel(input.complexityScore)}/20`;
  }

  private buildDescription(input: IPromptGenerationInput): string {
    return `## Description

${input.description || 'No detailed description provided.'}`;
  }

  private buildAcceptanceCriteria(input: IPromptGenerationInput): string {
    if (!input.acceptanceCriteria) {
      return `## Acceptance Criteria

- Implementation matches the task description
- Code follows project conventions
- No breaking changes to existing functionality`;
    }

    return `## Acceptance Criteria

${input.acceptanceCriteria}`;
  }

  private buildTechnicalRequirements(input: IPromptGenerationInput): string {
    const requirements = [
      '- Follow TypeScript best practices with proper types',
      '- Include comprehensive error handling',
      '- Add JSDoc comments for public methods',
      '- Follow existing code patterns in the repository',
      '- Ensure code is production-ready',
    ];

    // Add complexity-specific requirements
    if (input.complexityScore >= 10) {
      requirements.push(
        '- Consider impact on other modules',
        '- Update any affected imports/exports',
        '- Add inline comments for complex logic',
      );
    }

    // Add tag-specific requirements
    if (input.tags.includes('architecture')) {
      requirements.push(
        '- Document architectural decisions',
        '- Consider scalability implications',
      );
    }

    if (input.tags.includes('security')) {
      requirements.push(
        '- Follow security best practices',
        '- Validate all inputs',
        '- Sanitize outputs appropriately',
      );
    }

    return `## Technical Requirements

${requirements.join('\n')}`;
  }

  private buildProjectContext(context: IProjectContext): string {
    const sections = [
      `## Project Context`,
      ``,
      `**Project:** ${context.projectName}`,
      `**Tech Stack:** ${context.techStack.join(', ')}`,
      `**Key Dependencies:** ${context.dependencies.slice(0, 10).join(', ')}`,
      ``,
      `### Coding Standards`,
      ``,
      `${context.codingStandards.map((s) => `- ${s}`).join('\n')}`,
    ];

    if (context.architectureConstraints && context.architectureConstraints.length > 0) {
      sections.push(``);
      sections.push(`### Architecture Constraints`);
      sections.push(``);
      sections.push(`**CRITICAL: You must adhere to these architecture constraints:**`);
      sections.push(``);
      sections.push(`${context.architectureConstraints.map((s) => `- ${s}`).join('\n')}`);
    }

    return sections.join('\n');
  }

  private buildRelevantFiles(context: IProjectContext): string {
    const files = context.relevantFiles.map((f) => {
      let line = `- \`${f.path}\``;
      if (f.description) {
        line += ` - ${f.description}`;
      }
      return line;
    });

    return `## Relevant Files to Modify

${files.join('\n')}

**Note:** Review these files for existing patterns before implementing changes.`;
  }

  private buildOutputFormat(): string {
    return `## Output Requirements

Generate production-ready code that:
1. Implements all acceptance criteria
2. Follows existing patterns in the codebase
3. Includes proper TypeScript types
4. Has appropriate error handling
5. Is well-documented with comments

**Important:** Make changes directly to the files. Cursor will track all modifications.

## Architecture Decision Records (ADR)

**When to generate an ADR:** If your implementation involves ANY of the following significant architectural decisions:
- Adding new dependencies or libraries
- Database schema changes or migrations
- Breaking changes to existing APIs
- Infrastructure or deployment changes
- Major refactoring affecting multiple modules
- Security-sensitive changes
- Performance optimization strategies
- New design patterns or architectural patterns

**ADR Output Format (JSON):**
If you make a significant architectural decision, OR if you must violate a stated Architecture Constraint, include an ADR in your response using this exact JSON structure.
IMPORTANT: If violating a constraint, 'context' must explain precisely WHY the violation is necessary.

\`\`\`json
{
  "adr": {
    "title": "Short descriptive name (e.g., 'Use Redis for Session Storage')",
    "context": "Why this decision is needed",
    "decision": "What was chosen",
    "consequences": "Positive and negative impacts",
    "alternatives": "Other options considered",
    "ai_confidence": 0.85,
    "risk_level": "HIGH | MEDIUM | LOW"
  }
}
\`\`\`

**ADR Fields:**
- \`title\`: Clear, concise name (1-10 words)
- \`context\`: Why the decision is needed (2-3 sentences)
- \`decision\`: What was chosen and why (2-4 sentences)
- \`consequences\`: Positive/negative trade-offs (3-5 bullet points)
- \`alternatives\`: Other options you evaluated (2-3 alternatives)
- \`ai_confidence\`: Your confidence in this decision (0.0-1.0)
- \`risk_level\`: HIGH (dependencies/schema), MEDIUM (refactoring), LOW (minor changes)

**Example ADR:**
\`\`\`json
{
  "adr": {
    "title": "Use Zod for Runtime Validation",
    "context": "NestJS class-validator doesn't provide runtime type safety for complex nested objects",
    "decision": "Adopt Zod for DTO validation to get both compile-time and runtime safety",
    "consequences": "+ Type-safe validation\\n+ Better error messages\\n+ Developer experience improved\\n- New dependency\\n- Migration effort needed",
    "alternatives": "io-ts (more complex), AJV (JSON schema only), stick with class-validator (no runtime safety)",
    "ai_confidence": 0.90,
    "risk_level": "MEDIUM"
  }
}
\`\`\``;
  }

  private buildFeedback(feedback: string): string {
    return `## 🚨 Feedback from Previous Execution

The previous execution was rejected or requested for modification. Please address the following feedback in your implementation:

> ${feedback}

**Requirement:** You MUST explicitly address this feedback in your changes.`;
  }

  private buildEscalationGuidance(guidance: string): string {
    return `## 🎯 Technical Lead Guidance (Architecture Escalation)

**IMPORTANT:** This task was previously escalated due to AI uncertainty. The Technical Lead has provided the following guidance to resolve the architectural decision:

> ${guidance}

**Requirements:**
- Follow the TL's guidance precisely
- If the guidance references specific approaches or patterns, implement them exactly as described
- Document this decision in your ADR output (reference this guidance in the 'context' field)
- Do NOT deviate from the TL's recommendation unless there's a critical blocker (in which case, explain in ADR)`;
  }

  private getComplexityLabel(score: number): string {
    if (score >= 16) return 'Very High';
    if (score >= 12) return 'High';
    if (score >= 8) return 'Medium';
    if (score >= 4) return 'Low';
    return 'Very Low';
  }
}
