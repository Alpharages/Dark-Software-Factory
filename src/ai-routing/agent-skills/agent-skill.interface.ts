/**
 * Agent Skill Interface
 *
 * An "agent skill" is a small, focused AI task: it takes structured context,
 * builds a prompt, calls the LLM, and returns a parsed result.
 *
 * Skills are provider-agnostic — the AgentSkillRunner handles the actual
 * LLM call. New skills are added by implementing IAgentSkill and registering
 * them with the runner. No provider coupling in skill definitions.
 *
 * Pattern: context → prompt → raw LLM response → parsed result
 */

/**
 * The raw output from an agent skill LLM call.
 */
export interface ISkillOutput {
  /** The primary answer/value extracted from the LLM response */
  value: string;

  /** Optional: LLM's reasoning (if the prompt requested chain-of-thought) */
  reasoning?: string;
}

/**
 * Contract for all agent skills.
 *
 * @template TContext - The input shape this skill expects
 */
export interface IAgentSkill<TContext = Record<string, unknown>> {
  /** Unique identifier for the skill (used for logging and metrics) */
  readonly name: string;

  /** Human-readable description of what the skill does */
  readonly description: string;

  /**
   * Builds the LLM prompt from the provided context.
   * Keep prompts focused — one question, one answer.
   */
  buildPrompt(context: TContext): string;

  /**
   * Parses the raw LLM text response into structured output.
   * Should handle unexpected/malformed responses gracefully.
   */
  parseResponse(raw: string, context: TContext): ISkillOutput;
}
