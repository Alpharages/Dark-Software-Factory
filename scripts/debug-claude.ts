/**
 * Debug Script for Claude Code Provider
 * Run with: npx ts-node -r tsconfig-paths/register scripts/debug-claude.ts
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ClaudeCodeProvider } from '../src/ai-routing/providers/claude-code.provider';
import { WorkspaceService } from '../src/ai-routing/providers/workspace.service';
import { IAIExecutionInput } from '../src/ai-routing/interfaces';
import { Logger } from '@nestjs/common';

// Ensure all logs are shown
Logger.overrideLogger(['log', 'error', 'warn', 'debug', 'verbose']);

// Mock Metrics
const mockMetric = {
    inc: () => { },
    observe: () => { },
    set: () => { },
    dec: () => { },
};

async function run() {
    console.log('Starting Claude Code Provider Debug Script...');

    const module: TestingModule = await Test.createTestingModule({
        providers: [
            ClaudeCodeProvider,
            {
                provide: ConfigService,
                useValue: {
                    get: (key: string) => {
                        if (key === 'anthropic.apiKey') return process.env.ANTHROPIC_API_KEY;
                        // Ensure we use the 5 minute timeout for testing
                        if (key === 'anthropic.timeoutMs') return 300000;
                        if (key === 'anthropic.model') return process.env.ANTHROPIC_MODEL || 'claude-3-haiku-20240307';
                        return null;
                    },
                },
            },
            {
                provide: WorkspaceService,
                useValue: {
                    createWorkspace: async () => ({ path: process.cwd(), id: 'debug-ws' }),
                    updateWorkspaceStatus: () => { },
                    extractChanges: async () => ({ diff: 'diff content', filesChanged: ['debug.txt'] }),
                },
            },
            { provide: 'PROM_METRIC_CLAUDE_EXECUTIONS_TOTAL', useValue: mockMetric },
            { provide: 'PROM_METRIC_CLAUDE_EXECUTION_DURATION_SECONDS', useValue: mockMetric },
            { provide: 'PROM_METRIC_CLAUDE_ACTIVE_EXECUTIONS', useValue: mockMetric },
            { provide: 'PROM_METRIC_CLAUDE_TOKENS_TOTAL', useValue: mockMetric },
            { provide: 'PROM_METRIC_CLAUDE_COST_CENTS', useValue: mockMetric },
        ],
    }).compile();

    const provider = module.get<ClaudeCodeProvider>(ClaudeCodeProvider);
    await provider.onModuleInit();

    const input: IAIExecutionInput = {
        correlationId: 'debug-run',
        executionId: 'exec-debug-1',
        ticketId: 'TICKET-123',
        // Use a very simple prompt to verify functionality
        prompt: 'Create a file named hello_debug.txt with the content "Hello Verification"',
        repositoryUrl: 'https://github.com/example/repo.git',
        baseBranch: 'main',
        // Explicitly pass 5 minutes
        timeoutMs: 300000,
    };

    try {
        console.log('Calling provider.execute...');
        const result = await provider.execute(input);
        console.log('Execution Result:', JSON.stringify(result, null, 2));
    } catch (error) {
        console.error('Execution Failed:', error);
    } finally {
        console.log('Destroying module...');
        await provider.onModuleDestroy();
    }
}

run();
