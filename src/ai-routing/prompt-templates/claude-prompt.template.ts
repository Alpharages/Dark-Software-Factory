import { Injectable } from '@nestjs/common';
import { AIProvider } from '@/prisma/client';
import {
  IPromptBuilder,
  IPromptGenerationInput,
  IProjectContext,
  IRelevantFile,
} from '../interfaces';

/**
 * Claude Code Prompt Builder
 *
 * Per architecture: Claude Code uses extended context (200K+ tokens), so we:
 * - Include file contents inline for relevant context
 * - Emphasize autonomous coding capabilities
 * - Structure for tool use (edit_file)
 * - Provide rich context within the prompt
 */
@Injectable()
export class ClaudeCodePromptBuilder implements IPromptBuilder {
  readonly provider = AIProvider.CLAUDE_CODE;
  readonly maxTokens = 200000; // Claude extended context
  readonly templateVersion = '1.0.0'; // Increment when template structure changes

  /**
   * Build Claude Code optimized prompt with inline file contents
   */
  build(input: IPromptGenerationInput, context?: IProjectContext): string {
    const sections: string[] = [];

    // 1. Role and Context Setup
    sections.push(this.buildRoleContext(input, context));

    // 2. Task Definition
    sections.push(this.buildTaskDefinition(input));

    // 3. Acceptance Criteria (BDD format)
    sections.push(this.buildAcceptanceCriteria(input));

    // 4. Technical Requirements
    sections.push(this.buildTechnicalRequirements(input));

    // 5. Project Context with File Structure
    if (context) {
      sections.push(this.buildProjectContext(context));
    }

    // 6. Relevant File Contents (INLINE - Claude's strength)
    if (context?.relevantFiles?.length) {
      sections.push(this.buildInlineFileContents(context.relevantFiles));
    }

    // 7. Output Instructions (tool use emphasis)
    sections.push(this.buildOutputInstructions());

    return sections.join('\n\n---\n\n');
  }

  /**
   * Estimate tokens (Claude uses ~3-4 chars per token)
   *
   * Note: This is an approximation with ~20% variance. For production accuracy,
   * consider using tiktoken or similar tokenizer libraries for precise counts.
   */
  estimateTokens(prompt: string): number {
    return Math.ceil(prompt.length / 3.5);
  }

  /**
   * Truncate if exceeds limit (prioritize task and AC over context)
   */
  /**
   * Truncate if exceeds limit (prioritize task and AC over context)
   */
  truncateIfNeeded(prompt: string): string {
    const estimated = this.estimateTokens(prompt);
    if (estimated <= this.maxTokens) {
      return prompt;
    }

    let truncated = prompt;

    // 1. Remove Inline File Contents (largest consumer)
    if (this.estimateTokens(truncated) > this.maxTokens) {
      // Replace content between "## Relevant File Contents" and "## Output Instructions"
      // with a summary note
      truncated = truncated.replace(
        /## Relevant File Contents[\s\S]*?(?=## Output Instructions)/,
        '## Relevant File Contents\n\n[File contents truncated to fit token limit. Please read files directly.]\n\n',
      );
    }

    // 2. Remove Project Context if still too large
    if (this.estimateTokens(truncated) > this.maxTokens) {
      truncated = truncated.replace(
        /## Project Context[\s\S]*?(?=## Relevant File Contents|## Output Instructions)/,
        '',
      );
    }

    // 3. Fallback to hard truncation if still too large
    if (this.estimateTokens(truncated) > this.maxTokens) {
      const targetLength = this.maxTokens * 3.5;
      truncated = truncated.substring(0, targetLength) + '\n\n[Content truncated]';
    }

    return truncated;
  }

  private buildRoleContext(input: IPromptGenerationInput, context?: IProjectContext): string {
    const projectName = context?.projectName || 'Unknown Project';
    const techStack = context?.techStack?.join(', ') || 'TypeScript, NestJS';

    return `# Developer Task Assignment

You are an expert developer working on **${projectName}**.

**Tech Stack:** ${techStack}

Your task is to implement a feature based on the requirements below. You have full access to read files, analyze the codebase, and make necessary changes.`;
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
      'Follow existing code patterns and conventions',
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

  private buildProjectContext(context: IProjectContext): string {
    const standards =
      context.codingStandards.length > 0
        ? context.codingStandards.map((s) => `- ${s}`).join('\n')
        : '- Follow existing patterns in the codebase';

    const deps = context.dependencies.slice(0, 15).join(', ');

    return `## Project Context

**Project:** ${context.projectName}
**Tech Stack:** ${context.techStack.join(', ')}

### Key Dependencies

${deps}

### Coding Standards

${standards}

### File Structure

\`\`\`
${context.fileStructure || 'src/\n  modules/\n  common/\n  config/'}
\`\`\``;
  }

  private buildInlineFileContents(files: IRelevantFile[]): string {
    if (!files.length) return '';

    const fileBlocks = files
      .filter((f) => f.content) // Only include files with content
      .slice(0, 5) // Limit to 5 files to manage context size
      .map((f) => {
        const header = f.description ? `// ${f.description}\n` : '';
        return `### File: \`${f.path}\`
${f.linesOfCode ? `(${f.linesOfCode} lines)` : ''}

\`\`\`typescript
${header}${f.content}
\`\`\``;
      });

    if (!fileBlocks.length) {
      return `## Relevant Files

${files.map((f) => `- \`${f.path}\`${f.description ? ` - ${f.description}` : ''}`).join('\n')}

**Note:** Analyze these files for existing patterns before implementing.`;
    }

    return `## Relevant File Contents

The following files are relevant to this task. Study them for patterns and conventions:

${fileBlocks.join('\n\n')}`;
  }

  private buildOutputInstructions(): string {
    return `## Output Instructions

**IMPORTANT:** Generate production-ready code following these guidelines:

1. **Implementation Approach:**
   - First, analyze the existing codebase patterns
   - Plan your changes before implementing
   - Make incremental, focused changes

2. **Code Quality:**
   - All code must be TypeScript with proper types
   - Include error handling for edge cases
   - Add meaningful comments for complex logic

3. **Output Format:**
   Provide complete file contents with clear file paths:
   
   \`\`\`typescript
   // File: src/path/to/file.ts
   // [Complete file content here]
   \`\`\`

4. **Multiple Files:**
   If modifying multiple files, provide each separately with clear demarcation.

5. **Testing Consideration:**
   Ensure your implementation is testable and follows the existing test patterns.

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
\`\`\`

**Begin your implementation now.**`;
  }

  private getComplexityLabel(score: number): string {
    if (score >= 16) return 'Very High - Multi-file with architecture impact';
    if (score >= 12) return 'High - Multiple components affected';
    if (score >= 8) return 'Medium - Moderate scope';
    if (score >= 4) return 'Low - Focused change';
    return 'Very Low - Simple fix';
  }
}
