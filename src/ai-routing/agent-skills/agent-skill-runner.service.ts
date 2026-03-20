import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { IAgentSkill, ISkillOutput } from './agent-skill.interface';

/**
 * AgentSkillRunner
 *
 * Provider-agnostic engine for executing agent skills. Decouples WHAT a skill
 * does (prompt engineering + parsing) from HOW the LLM is called.
 *
 * Current backend: Anthropic API (model configured via ANTHROPIC_MODEL env var).
 * Future: swap the backend without changing any skill definitions.
 *
 * Always returns null on failure — never throws. Callers decide what to do
 * when a skill produces no result.
 */
@Injectable()
export class AgentSkillRunner {
  private readonly logger = new Logger(AgentSkillRunner.name);
  private readonly anthropic: Anthropic | null;
  private readonly model: string;

  /** Token budget for skill responses — skills return short, structured answers */
  private readonly MAX_TOKENS = 64;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('anthropic.apiKey');
    this.model = this.config.get<string>('anthropic.model') ?? 'claude-haiku-4-5-20251001';
    this.anthropic = apiKey ? new Anthropic({ apiKey }) : null;

    if (!this.anthropic) {
      this.logger.warn('AgentSkillRunner: no Anthropic API key — all skills will return null');
    } else {
      this.logger.log(`AgentSkillRunner: ready (model: ${this.model})`);
    }
  }

  /**
   * Execute a skill against the given context.
   *
   * @param skill  The skill to run
   * @param context  Input data the skill needs to build its prompt
   * @param correlationId  For log tracing
   * @returns Parsed skill output, or null if LLM call failed / not configured
   */
  async run<TContext>(
    skill: IAgentSkill<TContext>,
    context: TContext,
    correlationId?: string,
  ): Promise<ISkillOutput | null> {
    const tag = correlationId ? `[${correlationId}] ` : '';

    if (!this.anthropic) {
      this.logger.debug(`${tag}Skill '${skill.name}' skipped — no LLM backend configured`);
      return null;
    }

    const prompt = skill.buildPrompt(context);

    try {
      const response = await this.anthropic.messages.create({
        model: this.model,
        max_tokens: this.MAX_TOKENS,
        messages: [{ role: 'user', content: prompt }],
      });

      const content = response.content[0];
      if (content.type !== 'text' || !content.text.trim()) {
        this.logger.warn(`${tag}Skill '${skill.name}' returned empty response`);
        return null;
      }

      const result = skill.parseResponse(content.text, context);
      this.logger.debug(`${tag}Skill '${skill.name}' → '${result.value}'`);
      return result;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`${tag}Skill '${skill.name}' LLM call failed: ${msg}`);
      return null;
    }
  }
}
