export enum OpenHarnessSkill {
  CLICKUP_DEV_IMPLEMENT = 'clickup-dev-implement',
  CLICKUP_CODE_REVIEW = 'clickup-code-review',
  CLICKUP_QA = 'clickup-qa',
}

/**
 * Canonical prompt string persisted on an `Execution` row for an OpenHarness run.
 *
 * Single source of truth shared by the runner (which WRITES it when creating the
 * execution) and the dispatcher loop-cap (which QUERIES by it to count prior
 * implement runs). Keeping both sides on this one helper prevents the count from
 * silently matching zero rows if the prompt format ever changes.
 */
export function openHarnessSkillPrompt(skill: string): string {
  return `Run OpenHarness skill: ${skill}`;
}
