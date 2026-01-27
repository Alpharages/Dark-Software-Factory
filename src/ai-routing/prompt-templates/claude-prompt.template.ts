import { Injectable } from '@nestjs/common';
import { AIProvider } from '@/prisma/client';
import { IPromptBuilder, IPromptGenerationInput, IProjectContext } from '../interfaces';

/**
 * Claude Code Prompt Builder
 *
 * Per architecture: Claude Code uses extended context (200K+ tokens), so we:
 * - Emphasize autonomous coding capabilities
 * - Structure for tool use (edit_file)
 * - REMOVED: Inline file contents and project context (Claude Code manages this autonomously)
 */
@Injectable()
export class ClaudeCodePromptBuilder implements IPromptBuilder {
  readonly provider = AIProvider.CLAUDE_CODE;
  readonly maxTokens = 200000; // Claude extended context
  readonly templateVersion = '2.0.0'; // Major version bump for context removal

  /**
   * Build Claude Code optimized prompt
   * Note: Context arguments are largely ignored as Claude Code handles discovery
   */

  build(input: IPromptGenerationInput, _context?: IProjectContext): string {
    const sections: string[] = [];

    // 1. Role and Context Setup
    sections.push(this.buildRoleContext(input));

    // 2. Task Definition
    sections.push(this.buildTaskDefinition(input));

    // 3. Acceptance Criteria (BDD format)
    sections.push(this.buildAcceptanceCriteria(input));

    // 4. Technical Requirements
    sections.push(this.buildTechnicalRequirements(input));

    // 5. Feedback from Previous Execution
    if (input.feedback) {
      sections.push(this.buildFeedback(input.feedback));
    }

    // 6. Output Instructions (tool use emphasis)
    sections.push(this.buildOutputInstructions());

    return sections.join('\n\n---\n\n');
  }

  /**
   * Estimate tokens (Claude uses ~3-4 chars per token)
   */
  estimateTokens(prompt: string): number {
    return Math.ceil(prompt.length / 3.5);
  }

  /**
   * Truncate if exceeds limit (Simple truncation as we no longer have large optional blocks)
   */
  truncateIfNeeded(prompt: string): string {
    const estimated = this.estimateTokens(prompt);
    if (estimated <= this.maxTokens) {
      return prompt;
    }

    // Fallback to hard truncation
    const targetLength = this.maxTokens * 3.5;
    return prompt.substring(0, targetLength) + '\n\n[Content truncated]';
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private buildRoleContext(input: IPromptGenerationInput): string {
    return `# Developer Task Assignment

You are an expert autonomous developer.

Your task is to implement a feature based on the requirements below. you MUST:
1. EXPLORE the codebase to understand the context, dependencies, and project structure.
2. Read relevant files to understand existing patterns.
3. Implement the changes autonomously.`;
  }

  private buildTaskDefinition(input: IPromptGenerationInput): string {
    return `## Task: ${input.title}

**Ticket ID:** ${input.ticketId}
**Complexity Score:** ${input.complexityScore}/20 (${this.getComplexityLabel(input.complexityScore)})

### Description

${input.description || 'Implement the feature as described in the task title and acceptance criteria.'}`;
  }

  private buildAcceptanceCriteria(input: IPromptGenerationInput): string {
    if (!input.acceptanceCriteria) {
      return `## Acceptance Criteria

**Given** the implementation is complete  
**When** the code is reviewed  
**Then** it should:
- Match the task description exactly
- Follow project conventions
- Include proper error handling
- Be production-ready`;
    }

    // Parse and enhance acceptance criteria
    const criteria = input.acceptanceCriteria;

    return `## Acceptance Criteria

${criteria}

**Verification:** Each criterion above MUST be satisfied for the implementation to be complete.`;
  }

  private buildTechnicalRequirements(input: IPromptGenerationInput): string {
    const requirements = [
      'Follow TypeScript best practices with strict typing',
      'Include comprehensive error handling with meaningful messages',
      'Add JSDoc documentation for all public APIs',
      'Follow existing code patterns and conventions (DISCOVERED via exploration)',
      'Ensure changes are backward-compatible unless explicitly required otherwise',
    ];

    // Complexity-based additions
    if (input.complexityScore >= 10) {
      requirements.push(
        'Consider cross-module dependencies and update imports accordingly',
        'Add detailed inline comments for complex logic blocks',
        'Create or update any necessary interfaces/types',
      );
    }

    if (input.complexityScore >= 15) {
      requirements.push(
        'Document any architectural decisions made',
        'Consider performance implications of the implementation',
        'Ensure proper separation of concerns',
      );
    }

    // Tag-based requirements
    if (input.tags.includes('security')) {
      requirements.push(
        'Apply input validation for all external data',
        'Sanitize any user-provided content',
        'Follow OWASP security guidelines',
      );
    }

    if (input.tags.includes('database')) {
      requirements.push(
        'Use parameterized queries (Prisma handles this)',
        'Consider database transaction requirements',
        'Add appropriate indexes if creating new queries',
      );
    }

    return `## Technical Requirements

${requirements.map((r, i) => `${i + 1}. ${r}`).join('\n')}`;
  }

  private buildOutputInstructions(): string {
    return `## Output Instructions

**IMPORTANT:**
1. **Explore First:** You have NO provided file contents. You MUST read files using your tools to understand the codebase.
2. **Context:** Do not assume dependencies or patterns. Check \`package.json\`, \`tsconfig.json\`, and similar files first.
3. **Tests:** Ensure your implementation is testable and follows the existing test patterns found in the repo.

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
If you make a significant architectural decision, include an ADR in your response using this exact JSON structure:

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

**Begin your autonomous implementation now.**`;
  }

  private buildFeedback(feedback: string): string {
    return `## 🚨 Feedback from Previous Execution

The previous execution was reviewed and changes were requested. You MUST address the following feedback:

> ${feedback}`;
  }

  private getComplexityLabel(score: number): string {
    if (score >= 16) return 'Very High - Multi-file with architecture impact';
    if (score >= 12) return 'High - Multiple components affected';
    if (score >= 8) return 'Medium - Moderate scope';
    if (score >= 4) return 'Low - Focused change';
    return 'Very Low - Simple fix';
  }
}
