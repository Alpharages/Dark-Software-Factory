import { ClickUpStatusSkill, IClickUpStatusSkillContext } from './clickup-status.skill';
import { ExecutionPhase } from './execution-phase.enum';

const makeCtx = (
  overrides: Partial<IClickUpStatusSkillContext> = {},
): IClickUpStatusSkillContext => ({
  taskName: 'Implement login page',
  currentStatus: 'Open',
  availableStatuses: ['Open', 'Coding', 'PR Ready', 'Code Review', 'QA', 'Done'],
  phase: ExecutionPhase.STARTED,
  hasAssignee: false,
  hasDueDate: false,
  hasTimeEstimate: false,
  ...overrides,
});

describe('ClickUpStatusSkill', () => {
  let skill: ClickUpStatusSkill;

  beforeEach(() => {
    skill = new ClickUpStatusSkill();
  });

  describe('metadata', () => {
    it('has a name and description', () => {
      expect(skill.name).toBe('clickup_status_transition');
      expect(skill.description).toBeTruthy();
    });
  });

  describe('buildPrompt', () => {
    it('includes the task name', () => {
      expect(skill.buildPrompt(makeCtx())).toContain('Implement login page');
    });

    it('includes the current status', () => {
      expect(skill.buildPrompt(makeCtx())).toContain('"Open"');
    });

    it('includes all available statuses', () => {
      const prompt = skill.buildPrompt(makeCtx());
      expect(prompt).toContain('Coding');
      expect(prompt).toContain('PR Ready');
      expect(prompt).toContain('Code Review');
      expect(prompt).toContain('Done');
    });

    it('describes STARTED phase as coding in progress', () => {
      const prompt = skill.buildPrompt(makeCtx({ phase: ExecutionPhase.STARTED }));
      expect(prompt.toLowerCase()).toMatch(/start|coding|progress/);
    });

    it('describes COMPLETED phase as PR created', () => {
      const prompt = skill.buildPrompt(makeCtx({ phase: ExecutionPhase.COMPLETED }));
      expect(prompt.toLowerCase()).toMatch(/pull request|pr|review/);
    });

    it('describes FAILED phase as requiring human attention', () => {
      const prompt = skill.buildPrompt(makeCtx({ phase: ExecutionPhase.FAILED }));
      expect(prompt.toLowerCase()).toMatch(/fail|block|human/);
    });

    it('lists missing fields when task has none', () => {
      const prompt = skill.buildPrompt(
        makeCtx({ hasAssignee: false, hasDueDate: false, hasTimeEstimate: false }),
      );
      expect(prompt).toContain('assignee');
      expect(prompt).toContain('due date');
      expect(prompt).toContain('time estimate');
    });

    it('reports none when all fields are present', () => {
      const prompt = skill.buildPrompt(
        makeCtx({ hasAssignee: true, hasDueDate: true, hasTimeEstimate: true }),
      );
      expect(prompt).toContain('none');
    });

    it('asks the LLM to reply with JSON containing status and pre-condition flags', () => {
      const prompt = skill.buildPrompt(makeCtx());
      expect(prompt).toContain('"status"');
      expect(prompt).toContain('"needsAssignee"');
      expect(prompt).toContain('"needsDueDate"');
      expect(prompt).toContain('"needsTimeEstimate"');
    });
  });

  describe('parseResponse — JSON path', () => {
    const ctx = makeCtx({
      availableStatuses: ['Open', 'Coding', 'PR Ready', 'Code Review', 'Done'],
    });

    it('parses a valid JSON response', () => {
      const raw = JSON.stringify({
        status: 'Coding',
        needsAssignee: true,
        needsDueDate: true,
        needsTimeEstimate: false,
      });
      const result = skill.parseResponse(raw, ctx);
      expect(result.value).toBe('Coding');
      const decision = ClickUpStatusSkill.decodeDecision(result);
      expect(decision?.needsAssignee).toBe(true);
      expect(decision?.needsDueDate).toBe(true);
      expect(decision?.needsTimeEstimate).toBe(false);
    });

    it('normalises status casing to match the available list', () => {
      const raw = JSON.stringify({
        status: 'pr ready',
        needsAssignee: false,
        needsDueDate: false,
        needsTimeEstimate: false,
      });
      const result = skill.parseResponse(raw, ctx);
      expect(result.value).toBe('PR Ready');
    });

    it('strips markdown code fences before parsing', () => {
      const raw =
        '```json\n' +
        JSON.stringify({
          status: 'Coding',
          needsAssignee: true,
          needsDueDate: false,
          needsTimeEstimate: false,
        }) +
        '\n```';
      const result = skill.parseResponse(raw, ctx);
      expect(result.value).toBe('Coding');
    });
  });

  describe('parseResponse — fallback path (non-JSON)', () => {
    const ctx = makeCtx({ availableStatuses: ['Open', 'Coding', 'Done'] });

    it('falls back to treating raw text as a status name', () => {
      const result = skill.parseResponse('  Coding  ', ctx);
      expect(result.value).toBe('Coding');
    });

    it('preserves exact casing from the available list', () => {
      const result = skill.parseResponse('coding', ctx);
      expect(result.value).toBe('Coding');
    });

    it('returns raw value when not in the status list', () => {
      const result = skill.parseResponse('Unknown Status', ctx);
      expect(result.value).toBe('Unknown Status');
    });

    it('returns null decision on fallback path', () => {
      const result = skill.parseResponse('Coding', ctx);
      expect(ClickUpStatusSkill.decodeDecision(result)).toBeNull();
    });
  });

  describe('decodeDecision', () => {
    it('returns null when reasoning is absent', () => {
      expect(ClickUpStatusSkill.decodeDecision({ value: 'Coding' })).toBeNull();
    });

    it('returns null when reasoning is malformed JSON', () => {
      expect(
        ClickUpStatusSkill.decodeDecision({ value: 'Coding', reasoning: 'not-json' }),
      ).toBeNull();
    });

    it('returns the full decision when reasoning is valid', () => {
      const decision = {
        status: 'Coding',
        needsAssignee: true,
        needsDueDate: false,
        needsTimeEstimate: true,
      };
      const result = { value: 'Coding', reasoning: JSON.stringify(decision) };
      expect(ClickUpStatusSkill.decodeDecision(result)).toEqual(decision);
    });
  });
});
