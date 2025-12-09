/**
 * AI Delegation Example: Pull Request Creation
 * 
 * Demonstrates how to delegate PR description formatting to AI.
 * 
 * Source: Story 4.4 - Pull Request Creation & Metadata
 * LOC Saved: ~150 (eliminates custom PR templates and diff summarization)
 */

// ✅ AI DELEGATION APPROACH (Story 4.4)
class GitHubPROrchestrator {
    constructor(
        private orchestratorService: OrchestratorService,
        private gitHubRepository: GitHubRepository,
        private gitHubService: GitHubService,
        private metricsService: MetricsService,
    ) { }

    /**
     * Create pull request with AI-generated description
     */
    async createPullRequest(task: PRTask): Promise<PRResult> {
        // 1. ORCHESTRATION: Validate PR can be created
        await this.validatePRTask(task);

        // 2. INSTRUCTION: Build AI prompt for PR description
        const prompt = this.buildPRDescriptionPrompt(task);

        // 3. EXECUTION: Delegate to AI
        const startTime = Date.now();
        const aiResponse = await this.orchestratorService.executeTask(prompt, {
            taskType: 'pr-description-generation',
            ticketId: task.ticketId,
        });

        // 4. PARSING: Extract structured PR data from AI response
        const prDescription = this.parsePRDescription(aiResponse.output);

        // 5. CREATE PR: Use GitHub API with AI-generated description
        const prUrl = await this.gitHubService.createPR({
            owner: task.repositoryOwner,
            repo: task.repositoryName,
            title: `Story ${task.ticketId}: ${prDescription.summary}`,
            body: this.formatPRBody(prDescription),
            head: task.branchName,
            base: task.baseBranch || 'main',
        });

        // 6. STORAGE: Save PR metadata to database
        const prRecord = await this.gitHubRepository.savePR({
            ticketId: task.ticketId,
            executionId: task.executionId,
            url: prUrl,
            title: `Story ${task.ticketId}: ${prDescription.summary}`,
            description: prDescription,
            branch: task.branchName,
            baseBranch: task.baseBranch || 'main',
            timestamp: new Date(),
        });

        // 7. OBSERVABILITY: Record metrics
        this.metricsService.recordGitHubOperation({
            operation: 'pull_request',
            status: 'success',
            duration: Date.now() - startTime,
        });

        return {
            success: true,
            prUrl,
            prRecord,
        };
    }

    /**
     * Build AI prompt for PR description generation
     * 
     * AI handles:
     * - Summarizing changes from git diff
     * - Extracting key modifications per file
     * - Generating testing instructions
     * - Formatting in markdown
     */
    private buildPRDescriptionPrompt(task: PRTask): string {
        return `Generate a comprehensive pull request description for the following ticket.
    
    Ticket ID: ${task.ticketId}
    Ticket Title: ${task.ticketTitle}
    Ticket Description: ${task.ticketDescription}
    Branch: ${task.branchName}
    
    Changed Files (${task.changedFiles.length}):
    ${task.changedFiles.map(f => `- ${f.path} (+${f.additions} -${f.deletions})`).join('\n')}
    
    Commit Messages:
    ${task.commitMessages.map(m => `- ${m}`).join('\n')}
    
    Requirements:
    1. Create a concise summary (1-2 sentences) of what this PR accomplishes
    2. List the key changes made, grouped by feature/module
    3. Include testing instructions for reviewers
    4. Mention any breaking changes or important notes
    
    Return JSON in this exact format:
    {
      "summary": "Brief 1-2 sentence overview",
      "changes": [
        "Change 1: Description",
        "Change 2: Description"
      ],
      "testing": "Step-by-step testing instructions",
      "notes": "Optional: Breaking changes, deployment notes, etc."
    }`;
    }

    /**
     * Parse AI response to extract PR description data
     */
    private parsePRDescription(aiOutput: string): PRDescription {
        try {
            // AI should return JSON, parse it
            const parsed = JSON.parse(aiOutput);

            return {
                summary: parsed.summary || 'No summary provided',
                changes: parsed.changes || [],
                testing: parsed.testing || 'No testing instructions provided',
                notes: parsed.notes || '',
            };
        } catch (error) {
            // Fallback: Use AI output as-is if not valid JSON
            return {
                summary: aiOutput.substring(0, 200),
                changes: [],
                testing: 'See commit history for details',
                notes: '',
            };
        }
    }

    /**
     * Format PR description as markdown
     * 
     * DSF owns formatting (presentation logic)
     */
    private formatPRBody(description: PRDescription): string {
        const sections = [];

        // Summary
        sections.push(`## Summary\n\n${description.summary}`);

        // Changes
        if (description.changes.length > 0) {
            sections.push(`## Changes Made\n\n${description.changes.map(c => `- ${c}`).join('\n')}`);
        }

        // Testing
        sections.push(`## Testing Instructions\n\n${description.testing}`);

        // Notes
        if (description.notes) {
            sections.push(`## Important Notes\n\n${description.notes}`);
        }

        return sections.join('\n\n');
    }

    private async validatePRTask(task: PRTask): Promise<void> {
        if (!task.ticketId || !task.branchName) {
            throw new Error('Invalid PR task: missing required fields');
        }

        // Business logic: Ensure branch exists
        const branchExists = await this.gitHubService.branchExists(
            task.repositoryOwner,
            task.repositoryName,
            task.branchName
        );

        if (!branchExists) {
            throw new Error(`Branch ${task.branchName} does not exist`);
        }
    }
}

/**
 * COMPARISON: Why AI Delegation Wins
 * 
 * ❌ OLD APPROACH: Custom Templates
 * - Build PR description templates (80+ LOC)
 * - Parse git diff to extract changes (50+ LOC)
 * - Summarize commits manually (20+ LOC)
 * - Total: ~150 LOC
 * - Maintenance: Update templates for new patterns
 * - Quality: Generic, template-driven descriptions
 * 
 * ✅ AI DELEGATION:
 * - Build prompt (25 LOC)
 * - Parse JSON response (20 LOC)
 * - Format markdown (15 LOC)
 * - Total: ~60 LOC (60% reduction)
 * - Maintenance: Zero template maintenance
 * - Quality: Context-aware, detailed descriptions
 * 
 * BENEFITS:
 * 1. Better PR descriptions: AI understands context and intent
 * 2. Reduced maintenance: No templates to update
 * 3. Consistent format: AI follows structure reliably
 * 4. Testing instructions: AI generates relevant test steps
 * 
 * COST ANALYSIS:
 * - Token cost per PR: ~$0.02 (2K tokens @ $0.01/1K)
 * - Developer time saved: ~4 hours (building + maintaining templates)
 * - Reviewer time saved: ~30 min per PR (better descriptions = faster reviews)
 * - ROI: ~200x return
 */

// TypeScript interfaces for reference
interface PRTask {
    ticketId: string;
    ticketTitle: string;
    ticketDescription: string;
    executionId: string;
    repositoryOwner: string;
    repositoryName: string;
    branchName: string;
    baseBranch?: string;
    changedFiles: FileChange[];
    commitMessages: string[];
}

interface FileChange {
    path: string;
    additions: number;
    deletions: number;
    status: 'added' | 'modified' | 'deleted';
}

interface PRDescription {
    summary: string;
    changes: string[];
    testing: string;
    notes?: string;
}

interface PRResult {
    success: boolean;
    prUrl: string;
    prRecord: any;
}

interface PRRecord {
    id: string;
    ticketId: string;
    executionId: string;
    url: string;
    title: string;
    description: PRDescription;
    branch: string;
    baseBranch: string;
    timestamp: Date;
}
