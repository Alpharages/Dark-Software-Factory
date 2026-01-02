import { Test, TestingModule } from '@nestjs/testing';
import { AIProvider } from '@/prisma/client';
import { getToken } from '@willsoto/nestjs-prometheus';
import { PromptGeneratorService } from './prompt-generator.service';
import { CursorPromptBuilder } from './prompt-templates/cursor-prompt.template';
import { ClaudeCodePromptBuilder } from './prompt-templates/claude-prompt.template';
import { IPromptGenerationInput, IProjectContext } from './interfaces';
import { ArchitectureConstraintsService } from '@/architecture-review/architecture-constraints.service';

describe('PromptGeneratorService', () => {
  let service: PromptGeneratorService;
  let _cursorBuilder: CursorPromptBuilder;
  let _claudeBuilder: ClaudeCodePromptBuilder;

  const mockMetrics = {
    inc: jest.fn(),
    observe: jest.fn(),
    startTimer: jest.fn(() => jest.fn()),
  };

  const mockConstraintsService = {
    findAll: jest.fn().mockResolvedValue([
      { type: 'ALLOWED_TECH', scope: 'GLOBAL', rules: { allowed: ['react'] } },
      { type: 'FORBIDDEN_TECH', scope: 'GLOBAL', rules: { forbidden: ['jquery'] } },
    ]),
  };

  const createInput = (
    overrides: Partial<IPromptGenerationInput> = {},
  ): IPromptGenerationInput => ({
    correlationId: 'test-corr-123',
    ticketId: 'ticket-456',
    clickupTaskId: 'task-789',
    provider: AIProvider.CLAUDE_CODE,
    complexityScore: 8,
    complexityBreakdown: {
      fileCount: 2,
      fileCountScore: 2,
      architectureChanges: false,
      architectureScore: 0,
      dependencyLevel: 'medium',
      dependencyScore: 2,
      estimatedLoc: 100,
      locScore: 2,
      tagComplexity: 'medium',
      tagScore: 2,
      totalScore: 8,
    },
    title: 'Implement user authentication endpoint',
    description:
      'Create a POST /auth/login endpoint that validates credentials and returns JWT token.',
    acceptanceCriteria: `**Given** valid credentials are provided
**When** POST /auth/login is called
**Then** return 200 with JWT token

**Given** invalid credentials
**When** POST /auth/login is called
**Then** return 401 Unauthorized`,
    projectId: 'proj-001',
    tags: ['authentication', 'api'],
    routedAt: new Date().toISOString(),
    ...overrides,
  });

  const createContext = (): IProjectContext => ({
    projectName: 'Test Project',
    techStack: ['TypeScript', 'NestJS', 'PostgreSQL'],
    codingStandards: ['Use strict TypeScript', 'Follow NestJS patterns'],
    fileStructure: 'src/\n  modules/\n  common/',
    dependencies: ['@nestjs/core', '@nestjs/common'],
    relevantFiles: [
      {
        path: 'src/auth/auth.service.ts',
        description: 'Authentication service',
        linesOfCode: 150,
        content: 'export class AuthService { /* ... */ }',
      },
    ],
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PromptGeneratorService,
        CursorPromptBuilder,
        ClaudeCodePromptBuilder,
        { provide: getToken('prompt_generation_total'), useValue: mockMetrics },
        { provide: getToken('prompt_tokens_histogram'), useValue: mockMetrics },
        { provide: getToken('prompt_generation_duration_seconds'), useValue: mockMetrics },
        { provide: ArchitectureConstraintsService, useValue: mockConstraintsService },
      ],
    }).compile();

    service = module.get<PromptGeneratorService>(PromptGeneratorService);
    _cursorBuilder = module.get<CursorPromptBuilder>(CursorPromptBuilder);
    _claudeBuilder = module.get<ClaudeCodePromptBuilder>(ClaudeCodePromptBuilder);

    // Initialize the service
    service.onModuleInit();

    jest.clearAllMocks();
  });

  describe('generatePrompt', () => {
    it('should inject architecture constraints into context', async () => {
      const input = createInput({ provider: AIProvider.CURSOR_HEADLESS });
      // Assume context is created by default if not provided, or provided one gets enriched
      const context = createContext();

      await service.generatePrompt(input, context);

      expect(mockConstraintsService.findAll).toHaveBeenCalled();
      expect(context.architectureConstraints).toBeDefined();
      expect(context.architectureConstraints?.length).toBe(2);
      expect(context.architectureConstraints?.[0]).toContain('ALLOWED_TECH');
    });

    it('should generate Claude Code prompt with all sections', async () => {
      const input = createInput({ provider: AIProvider.CLAUDE_CODE });
      const context = createContext();

      const result = await service.generatePrompt(input, context);

      expect(result.provider).toBe(AIProvider.CLAUDE_CODE);
      expect(result.ticketId).toBe(input.ticketId);
      expect(result.correlationId).toBe(input.correlationId);
      expect(result.prompt).toContain(input.title);
      expect(result.prompt).toContain(input.description);
      expect(result.prompt).toContain('Acceptance Criteria');
      expect(result.prompt).toContain('Technical Requirements');
      expect(result.metadata.promptLength).toBeGreaterThan(0);
      expect(result.metadata.estimatedTokens).toBeGreaterThan(0);
    });

    it('should generate Cursor prompt without inline file contents', async () => {
      const input = createInput({ provider: AIProvider.CURSOR_HEADLESS });
      const context = createContext();

      const result = await service.generatePrompt(input, context);

      expect(result.provider).toBe(AIProvider.CURSOR_HEADLESS);
      expect(result.prompt).toContain(input.title);
      // Cursor prompts include file paths but not content
      expect(result.prompt).toContain(context.relevantFiles[0].path);
      // Should not have inline TypeScript code blocks from file content
      expect(result.metadata.contextFilesIncluded).toBe(false);
    });

    it('should include inline file contents for Claude Code', async () => {
      const input = createInput({ provider: AIProvider.CLAUDE_CODE });
      const context = createContext();

      const result = await service.generatePrompt(input, context);

      // Claude prompts include file contents inline
      expect(result.prompt).toContain('```typescript');
      expect(result.prompt).toContain(context.relevantFiles[0].content);
      expect(result.metadata.contextFilesIncluded).toBe(true);
    });

    it('should work without project context', async () => {
      const input = createInput();

      const result = await service.generatePrompt(input);

      expect(result.prompt).toContain(input.title);
      expect(result.prompt).toContain(input.description);
      expect(result.metadata.relevantFilesCount).toBe(0);
    });

    it('should include complexity-specific requirements for high complexity', async () => {
      const input = createInput({
        complexityScore: 15,
        tags: ['architecture'],
      });

      const result = await service.generatePrompt(input);

      expect(result.prompt).toContain('cross-module');
      expect(result.prompt).toContain('architectural');
    });

    it('should include security requirements when security tag present', async () => {
      const input = createInput({
        tags: ['security'],
      });

      const result = await service.generatePrompt(input);

      expect(result.prompt.toLowerCase()).toContain('security');
      expect(result.prompt.toLowerCase()).toContain('valid');
    });

    it('should track metrics correctly', async () => {
      const input = createInput();

      await service.generatePrompt(input);

      expect(mockMetrics.inc).toHaveBeenCalled();
      expect(mockMetrics.observe).toHaveBeenCalled();
      expect(mockMetrics.startTimer).toHaveBeenCalled();
    });

    it('should populate all metadata fields', async () => {
      const input = createInput();
      const context = createContext();

      const result = await service.generatePrompt(input, context);

      expect(result.metadata.promptLength).toBeGreaterThan(100);
      expect(result.metadata.estimatedTokens).toBeGreaterThan(0);
      expect(result.metadata.sectionsIncluded.length).toBeGreaterThan(0);
      expect(result.metadata.generatedAt).toBeInstanceOf(Date);
      expect(result.metadata.templateVersion).toBeDefined();
    });
  });

  describe('generatePromptString', () => {
    it('should return only the prompt string', async () => {
      const input = createInput();

      const result = await service.generatePromptString(input);

      expect(typeof result).toBe('string');
      expect(result).toContain(input.title);
    });
  });

  describe('getDefaultProjectContext', () => {
    it('should return Dark Software Factory context', () => {
      const context = service.getDefaultProjectContext();

      expect(context.projectName).toBe('ai-dev-orchestrator');
      expect(context.techStack).toContain('NestJS');
      expect(context.techStack).toContain('Prisma');
      expect(context.codingStandards.length).toBeGreaterThan(0);
    });
  });
});

describe('CursorPromptBuilder', () => {
  let builder: CursorPromptBuilder;

  beforeEach(() => {
    builder = new CursorPromptBuilder();
  });

  describe('build', () => {
    it('should create structured prompt with all sections', () => {
      const input: IPromptGenerationInput = {
        correlationId: 'test',
        ticketId: 'ticket-1',
        clickupTaskId: 'task-1',
        provider: AIProvider.CURSOR_HEADLESS,
        complexityScore: 8,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        complexityBreakdown: {} as any,
        title: 'Test Task',
        description: 'Test Description',
        acceptanceCriteria: 'Test AC',
        projectId: 'proj-1',
        tags: [],
        routedAt: new Date().toISOString(),
      };

      const result = builder.build(input);
      expect(result).toContain('# Task: Test Task');
      expect(result).toContain('## Description');
      expect(result).toContain('Test Description');
    });
  });
});
