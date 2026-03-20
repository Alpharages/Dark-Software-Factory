import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentSkillRunner } from './agent-skill-runner.service';
import { IAgentSkill, ISkillOutput } from './agent-skill.interface';

/** Minimal skill stub for testing the runner */
const makeSkill = (
  name = 'test_skill',
  parseResult: ISkillOutput = { value: 'parsed-result' },
): IAgentSkill<{ input: string }> => ({
  name,
  description: 'Test skill',
  buildPrompt: ({ input }) => `Prompt for: ${input}`,
  parseResponse: (raw) => (raw.trim() ? parseResult : { value: '' }),
});

describe('AgentSkillRunner', () => {
  let runner: AgentSkillRunner;
  let mockAnthropic: { messages: { create: jest.Mock } };

  const buildModule = async (apiKey: string | undefined = 'test-api-key') => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentSkillRunner,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockImplementation((key: string) => {
              if (key === 'anthropic.apiKey') return apiKey;
              if (key === 'anthropic.model') return 'claude-test-model';
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    return module.get<AgentSkillRunner>(AgentSkillRunner);
  };

  beforeEach(async () => {
    runner = await buildModule();

    mockAnthropic = { messages: { create: jest.fn() } };
    (runner as any).anthropic = mockAnthropic;

    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('when Anthropic API key is configured', () => {
    it('calls the LLM with the skill-built prompt', async () => {
      mockAnthropic.messages.create.mockResolvedValue({
        content: [{ type: 'text', text: 'parsed-result' }],
      });
      const skill = makeSkill();

      await runner.run(skill, { input: 'hello' });

      expect(mockAnthropic.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-test-model',
          messages: [{ role: 'user', content: 'Prompt for: hello' }],
        }),
      );
    });

    it('returns parsed result from skill.parseResponse', async () => {
      mockAnthropic.messages.create.mockResolvedValue({
        content: [{ type: 'text', text: 'raw-llm-output' }],
      });
      const skill = makeSkill('s', { value: 'parsed-result' });

      const result = await runner.run(skill, { input: 'x' });

      expect(result?.value).toBe('parsed-result');
    });

    it('returns null when LLM returns empty text', async () => {
      mockAnthropic.messages.create.mockResolvedValue({
        content: [{ type: 'text', text: '   ' }],
      });

      const result = await runner.run(makeSkill(), { input: 'x' });

      expect(result).toBeNull();
    });

    it('returns null when LLM returns non-text content block', async () => {
      mockAnthropic.messages.create.mockResolvedValue({
        content: [{ type: 'tool_use', id: 'tu-1', name: 'foo', input: {} }],
      });

      const result = await runner.run(makeSkill(), { input: 'x' });

      expect(result).toBeNull();
    });

    it('returns null and logs warning when LLM call throws', async () => {
      mockAnthropic.messages.create.mockRejectedValue(new Error('Rate limit exceeded'));

      const result = await runner.run(makeSkill(), { input: 'x' }, 'corr-123');

      expect(result).toBeNull();
    });

    it('passes correlationId through to logging context', async () => {
      mockAnthropic.messages.create.mockResolvedValue({
        content: [{ type: 'text', text: 'ok' }],
      });
      const warnSpy = jest.spyOn(Logger.prototype, 'warn');

      // Force an error so warn is called with correlationId context
      mockAnthropic.messages.create.mockRejectedValue(new Error('Timeout'));
      await runner.run(makeSkill(), { input: 'x' }, 'corr-abc');

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[corr-abc]'));
    });

    it('uses model from config', async () => {
      mockAnthropic.messages.create.mockResolvedValue({
        content: [{ type: 'text', text: 'result' }],
      });

      await runner.run(makeSkill(), { input: 'x' });

      expect(mockAnthropic.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'claude-test-model' }),
      );
    });
  });

  describe('when Anthropic API key is not configured', () => {
    it('returns null without calling the LLM', async () => {
      const noKeyRunner = await buildModule(undefined);
      (noKeyRunner as any).anthropic = null;

      const result = await noKeyRunner.run(makeSkill(), { input: 'x' });

      expect(result).toBeNull();
      expect(mockAnthropic.messages.create).not.toHaveBeenCalled();
    });
  });
});
