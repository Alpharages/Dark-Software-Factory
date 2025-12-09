/**
 * AI Delegation Example: Linting
 * 
 * Demonstrates how to delegate linting to AI instead of building custom parsers.
 * 
 * Source: Story 3.10 - QA Automation AI Delegation Refactor
 * LOC Saved: ~500 per linter (eliminates custom ESLint/Flake8/Pylint parsers)
 */

// ❌ OLD WAY (Epic 3): Custom service with parser
class LintingService {
    async lint(ticketId: string, projectDir: string): Promise<LintResult> {
        // 1. Detect which linter to use (ESLint, Flake8, RuboCop, Pylint)
        const linter = await this.detectLinter(projectDir);

        // 2. Build command based on linter type
        const command = this.buildLintCommand(linter, projectDir);

        // 3. Execute linter command
        const output = await execPromise(command);

        // 4. Parse output with custom regex (fragile, linter-specific)
        const issues = this.parseLinterOutput(output, linter);

        // 5. Transform to internal format
        const result = this.transformToInternalFormat(issues);

        // 6. Store in database
        await this.saveLintResult(ticketId, result);

        return result;
        // Total: ~500 LOC
        // Maintenance: Update parser for each linter version change
    }

    private detectLinter(projectDir: string): string {
        // Complex detection logic for each language/framework
        // 50+ LOC
    }

    private buildLintCommand(linter: string, projectDir: string): string {
        // Build command with correct flags for each linter
        // 30+ LOC
    }

    private parseLinterOutput(output: string, linter: string): Issue[] {
        // Regex patterns for ESLint, Flake8, RuboCop, Pylint, etc.
        // Fragile - breaks when linter output format changes
        // 200+ LOC
    }

    private transformToInternalFormat(issues: Issue[]): LintResult {
        // Transform to standardized format
        // 100+ LOC
    }
}

// ✅ NEW WAY (Epic 4 Pattern): AI Delegation
class AiQaOrchestrator {
    constructor(
        private orchestratorService: OrchestratorService, // AI executor
        private qaResultsRepository: QaResultsRepository,  // Database
        private metricsService: MetricsService,            // Observability
    ) { }

    async executeLintCheck(ticketId: string, projectDir: string): Promise<QaResult> {
        // 1. ORCHESTRATION: Decide to execute
        const shouldLint = await this.shouldRunLinting(ticketId);
        if (!shouldLint) return null;

        // 2. INSTRUCTION: Build AI prompt
        const prompt = this.buildLintPrompt(projectDir);

        // 3. EXECUTION: Delegate to AI
        const startTime = Date.now();
        const aiResult = await this.orchestratorService.executeTask(prompt, {
            workingDirectory: projectDir
        });

        // 4. PARSING: AI returns structured JSON
        const lintData = JSON.parse(aiResult.output);

        // 5. STORAGE: Save to database
        const qaResult = await this.qaResultsRepository.createLintResult({
            ticketId,
            status: lintData.status,
            errorCount: lintData.errorCount,
            warningCount: lintData.warningCount,
            issues: lintData.issues,
            executionTime: Date.now() - startTime,
        });

        // 6. DECISION: Apply business logic (quality gates)
        const passed = this.applyQualityGates(lintData);

        // 7. OBSERVABILITY: Record metrics
        this.metricsService.recordLintCheck({
            status: passed ? 'passed' : 'failed',
            errorCount: lintData.errorCount,
            duration: Date.now() - startTime,
        });

        return qaResult;
        // Total: ~30 LOC
        // Maintenance: Zero - AI adapts to new linters automatically
    }

    private buildLintPrompt(projectDir: string): string {
        return `Run linting checks in the project at ${projectDir}.
    
    Instructions:
    1. Detect what linters are configured (check package.json scripts, .eslintrc, pyproject.toml, etc.)
    2. Run the appropriate linting command (e.g., "npm run lint" or "flake8 .")
    3. Parse the output and categorize issues by severity
    
    Return JSON in this exact format:
    {
      "status": "passed" | "failed",
      "linter": "name of linter used",
      "errorCount": <number>,
      "warningCount": <number>,
      "issues": [
        {
          "file": "relative/path/to/file",
          "line": <number>,
          "column": <number>,
          "severity": "error" | "warning",
          "rule": "rule-name",
          "message": "issue description"
        }
      ]
    }`;
    }

    private applyQualityGates(lintData: any): boolean {
        // Simple business logic - DSF owns this decision
        return lintData.errorCount === 0;
    }
}

/**
 * KEY BENEFITS:
 * 
 * 1. LOC Reduction: 500 → 30 (94% reduction)
 * 2. Language Support: Works for Node.js, Python, Ruby, Go, etc. without code changes
 * 3. Linter Support: Automatically supports ESLint, Flake8, RuboCop, Pylint, Golint, etc.
 * 4. Maintenance: Zero parser maintenance - AI adapts to linter changes
 * 5. Client Tooling: Leverages client's existing "npm run lint" scripts
 * 
 * COST ANALYSIS:
 * - Token cost per lint check: ~$0.02 (assuming 2K tokens @ $0.01/1K)
 * - Developer time saved: ~10 hours (building + maintaining parsers)
 * - ROI: ~500x ($0.02 vs $200/hour developer time)
 */

// TypeScript interfaces for reference
interface LintResult {
    ticketId: string;
    status: 'passed' | 'failed';
    linter: string;
    errorCount: number;
    warningCount: number;
    issues: LintIssue[];
    executionTime: number;
}

interface LintIssue {
    file: string;
    line: number;
    column: number;
    severity: 'error' | 'warning';
    rule: string;
    message: string;
}

interface QaResult {
    id: string;
    ticketId: string;
    type: 'lint' | 'test' | 'coverage' | 'security';
    status: 'passed' | 'failed';
    data: any;
    createdAt: Date;
}
