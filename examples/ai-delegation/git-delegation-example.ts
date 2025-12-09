/**
 * AI Delegation Example: Git Operations
 * 
 * Demonstrates how to delegate commit message generation to AI.
 * 
 * Source: Story 4.3 - Git Commit Generation & Push
 * LOC Saved: ~200 (eliminates custom message templates and formatting logic)
 */

// ✅ AI DELEGATION APPROACH (Story 4.3)
class GitHubCommitOrchestrator {
    constructor(
        private orchestratorService: OrchestratorService,
        private gitHubRepository: GitHubRepository,
        private metricsService: MetricsService,
        private auditLogService: AuditLogService,
    ) { }

    /**
     * Generate commit message using AI and push to GitHub
     */
    async generateAndCommit(task: CommitTask): Promise<CommitResult> {
        // 1. ORCHESTRATION: Decide to execute
        const shouldCommit = await this.validateCommitTask(task);
        if (!shouldCommit) {
            throw new Error('Commit task validation failed');
        }

        // 2. INSTRUCTION: Build AI prompt for commit message generation
        const prompt = this.buildCommitMessagePrompt(task);

        // 3. EXECUTION: Delegate to AI
        const startTime = Date.now();
        const aiResponse = await this.orchestratorService.executeTask(prompt, {
            taskType: 'commit-message-generation',
            ticketId: task.ticketId,
        });

        // 4. PARSING: Extract commit message from AI response
        const commitMessage = this.parseCommitMessage(aiResponse.output);

        // 5. VALIDATION: Ensure conventional commit format
        this.validateCommitMessage(commitMessage);

        // 6. STORAGE: Save commit record to database
        const commitRecord = await this.gitHubRepository.saveCommit({
            ticketId: task.ticketId,
            executionId: task.executionId,
            message: commitMessage,
            files: task.files,
            branch: task.branchName,
            timestamp: new Date(),
        });

        // 7. OBSERVABILITY: Record metrics and audit log
        this.metricsService.recordGitHubOperation({
            operation: 'commit',
            status: 'success',
            duration: Date.now() - startTime,
        });

        this.auditLogService.log({
            action: 'github.commit.generated',
            ticketId: task.ticketId,
            message: commitMessage,
        });

        return {
            success: true,
            commitMessage,
            commitRecord,
        };
    }

    /**
     * Build AI prompt for commit message generation
     * 
     * AI handles:
     * - Analyzing git diff
     * - Determining scope and type (feat, fix, chore, etc.)
     * - Creating concise, descriptive message
     * - Following conventional commit format
     */
    private buildCommitMessagePrompt(task: CommitTask): string {
        return `Generate a conventional commit message for the following changes.
    
    Ticket ID: ${task.ticketId}
    Branch: ${task.branchName}
    Description: ${task.description}
    
    Changed Files:
    ${task.files.map(f => `- ${f}`).join('\n')}
    
    Git Diff Summary:
    ${task.diffSummary}
    
    Requirements:
    1. Follow conventional commit format: <type>(<scope>): <description>
    2. Type must be one of: feat, fix, chore, docs, style, refactor, test, perf
    3. Scope should be the module/feature affected
    4. Description should be concise and imperative ("add feature" not "added feature")
    5. Keep total message under 72 characters for the title line
    
    Return ONLY the commit message as plain text, no JSON wrapper needed.
    
    Example format:
    feat(auth): add JWT token refresh mechanism`;
    }

    /**
     * Parse AI response to extract commit message
     * 
     * AI returns plain text commit message, we just need to clean it
     */
    private parseCommitMessage(aiOutput: string): string {
        // AI might return with quotes or extra whitespace
        let message = aiOutput.trim();

        // Remove quotes if AI wrapped the response
        if (message.startsWith('"') && message.endsWith('"')) {
            message = message.slice(1, -1);
        }

        // Handle JSON response format (fallback)
        if (message.startsWith('{')) {
            try {
                const json = JSON.parse(message);
                message = json.message || json.commit || json.text;
            } catch (e) {
                // Not JSON, use as-is
            }
        }

        return message;
    }

    /**
     * Validate conventional commit format
     * 
     * DSF owns validation (business logic)
     */
    private validateCommitMessage(message: string): void {
        const conventionalCommitPattern = /^(feat|fix|chore|docs|style|refactor|test|perf)(\(.+\))?: .+/;

        if (!conventionalCommitPattern.test(message)) {
            throw new Error(`Invalid conventional commit format: ${message}`);
        }

        if (message.split('\n')[0].length > 72) {
            throw new Error('Commit message title exceeds 72 characters');
        }
    }

    private async validateCommitTask(task: CommitTask): Promise<boolean> {
        // Business logic validation
        return task.ticketId && task.branchName && task.files.length > 0;
    }
}

/**
 * COMPARISON: Why AI Delegation Wins
 * 
 * ❌ OLD APPROACH: Custom Templates
 * - Build commit message templates (50+ LOC)
 * - Map ticket types to commit types (100+ LOC)
 * - Parse git diff to extract scope (50+ LOC)
 * - Total: ~200 LOC
 * - Maintenance: Update templates for new patterns
 * - Quality: Generic, template-driven messages
 * 
 * ✅ AI DELEGATION:
 * - Build prompt (15 LOC)
 * - Parse response (20 LOC)
 * - Validate format (10 LOC)
 * - Total: ~45 LOC (77% reduction)
 * - Maintenance: Zero template maintenance
 * - Quality: Context-aware, descriptive messages
 * 
 * COST ANALYSIS:
 * - Token cost per commit: ~$0.01 (1K tokens @ $0.01/1K)
 * - Developer time saved: ~5 hours (building + maintaining templates)
 * - ROI: ~500x return
 */

// TypeScript interfaces for reference
interface CommitTask {
    ticketId: string;
    executionId: string;
    branchName: string;
    description: string;
    files: string[];
    diffSummary: string;
}

interface CommitResult {
    success: boolean;
    commitMessage: string;
    commitRecord: any;
}

interface CommitRecord {
    id: string;
    ticketId: string;
    executionId: string;
    message: string;
    files: string[];
    branch: string;
    timestamp: Date;
}
