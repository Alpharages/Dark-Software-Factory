import { IAgentSkill, ISkillOutput } from '../agent-skill.interface';
import { ExecutionPhase } from './execution-phase.enum';

/**
 * Context required by the ClickUp status transition skill.
 */
export interface IClickUpStatusSkillContext {
  taskName: string;
  currentStatus: string;
  /** All statuses available in this ClickUp list, in their natural order */
  availableStatuses: string[];
  phase: ExecutionPhase;
  /** Whether the task already has an assignee */
  hasAssignee: boolean;
  /** Whether the task already has a due date */
  hasDueDate: boolean;
  /** Whether the task already has a time estimate */
  hasTimeEstimate: boolean;
}

/**
 * Structured output from the skill.
 * The skill decides both WHAT status to set AND what pre-conditions to satisfy first.
 */
export interface IClickUpStatusDecision {
  /** The exact status name to transition to */
  status: string;
  /** Set the bot as assignee before transitioning (satisfies assignee automations) */
  needsAssignee: boolean;
  /** Set a due date before transitioning (satisfies due date automations) */
  needsDueDate: boolean;
  /** Set a time estimate before transitioning (satisfies estimate automations) */
  needsTimeEstimate: boolean;
}

const PHASE_DESCRIPTIONS: Record<ExecutionPhase, string> = {
  [ExecutionPhase.STARTED]:
    'An AI agent has just started coding on this task. Work is actively in progress.',
  [ExecutionPhase.COMPLETED]:
    'An AI agent has finished coding and a pull request has been created and is ready for review.',
  [ExecutionPhase.FAILED]: 'The AI execution failed or was blocked and requires human attention.',
  [ExecutionPhase.QA_FAILED]:
    'The AI agent exhausted all QA retries. The branch has been pushed but no PR was created — awaiting PM resolution.',
};

/**
 * ClickUpStatusSkill
 *
 * Determines the correct ClickUp status to transition a task to AND what
 * pre-conditions to satisfy before transitioning (assignee, due date, estimate).
 *
 * This handles workspace automation rules — many ClickUp workspaces block
 * status transitions (e.g. "cannot move to In Progress without an assignee").
 * The skill reasons about what fields to set first so the transition sticks.
 *
 * Returns structured JSON that the caller acts on in order:
 *   1. Set pre-conditions (assignee / due date / estimate)
 *   2. Transition status
 */
export class ClickUpStatusSkill implements IAgentSkill<IClickUpStatusSkillContext> {
  readonly name = 'clickup_status_transition';
  readonly description =
    'Selects the correct ClickUp status and required pre-conditions (assignee, due date, estimate) for an AI execution phase.';

  buildPrompt(ctx: IClickUpStatusSkillContext): string {
    const missingFields = [
      !ctx.hasAssignee && 'assignee',
      !ctx.hasDueDate && 'due date',
      !ctx.hasTimeEstimate && 'time estimate',
    ]
      .filter(Boolean)
      .join(', ');

    return (
      `You are a workflow automation agent for a software development team using ClickUp.\n\n` +
      `Task: "${ctx.taskName}"\n` +
      `Current status: "${ctx.currentStatus}"\n` +
      `Available statuses (in workflow order): ${ctx.availableStatuses.map((s) => `"${s}"`).join(', ')}\n` +
      `Missing fields: ${missingFields || 'none'}\n\n` +
      `Event: ${PHASE_DESCRIPTIONS[ctx.phase]}\n\n` +
      `Respond with a JSON object only — no explanation, no markdown:\n` +
      `{\n` +
      `  "status": "<exact status name from the list>",\n` +
      `  "needsAssignee": <true if assignee is missing and the target status likely requires one>,\n` +
      `  "needsDueDate": <true if due date is missing and the target status likely requires one>,\n` +
      `  "needsTimeEstimate": <true if time estimate is missing and the target status likely requires one>\n` +
      `}`
    );
  }

  parseResponse(raw: string, ctx: IClickUpStatusSkillContext): ISkillOutput {
    try {
      // Strip markdown code fences if the model wraps the JSON
      const json = raw.replace(/```(?:json)?\n?/g, '').trim();
      const parsed = JSON.parse(json) as Partial<IClickUpStatusDecision>;

      const status =
        typeof parsed.status === 'string' && parsed.status.trim() ? parsed.status.trim() : '';

      // Normalise to exact casing from the available list
      const matched = ctx.availableStatuses.find((s) => s.toLowerCase() === status.toLowerCase());

      const decision: IClickUpStatusDecision = {
        status: matched ?? status,
        needsAssignee: parsed.needsAssignee === true,
        needsDueDate: parsed.needsDueDate === true,
        needsTimeEstimate: parsed.needsTimeEstimate === true,
      };

      return {
        value: decision.status,
        // Encode the full decision in the reasoning field so the caller can access it
        reasoning: JSON.stringify(decision),
      };
    } catch {
      // Fallback: treat the raw text as just a status name with no pre-conditions
      const fallback = raw.trim();
      const matched = ctx.availableStatuses.find((s) => s.toLowerCase() === fallback.toLowerCase());
      return { value: matched ?? fallback };
    }
  }

  /**
   * Decode the full decision from the skill output.
   * Returns null if the output was produced by the fallback path.
   */
  static decodeDecision(output: ISkillOutput): IClickUpStatusDecision | null {
    if (!output.reasoning) return null;
    try {
      return JSON.parse(output.reasoning) as IClickUpStatusDecision;
    } catch {
      return null;
    }
  }
}
