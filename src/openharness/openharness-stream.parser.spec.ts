import { OpenHarnessStreamParser } from './openharness-stream.parser';

describe('OpenHarnessStreamParser', () => {
  let parser: OpenHarnessStreamParser;

  beforeEach(() => {
    parser = new OpenHarnessStreamParser();
  });

  it('should parse progress event', () => {
    const event = { type: 'progress', step: 'installing', percent: 10 };
    const result = parser.parseLine(JSON.stringify(event));

    expect(result).toEqual(event);
    expect(parser.getProgress()).toEqual(event);
  });

  it('should parse result event and accumulate files', () => {
    const event = {
      type: 'result',
      status: 'COMPLETED',
      files_changed: ['file1.ts', { file: 'file2.ts' }],
    };
    const result = parser.parseLine(JSON.stringify(event));

    expect(result).toEqual(event);
    expect(parser.getResult()).toEqual(event);
    expect(parser.getFilesChanged()).toEqual(['file1.ts', 'file2.ts']);
  });

  it('should accumulate tools used from assistant text', () => {
    const event = {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', name: 'grep_search' },
          { type: 'text', text: 'using tool' },
        ],
      },
    };

    const result = parser.parseLine(JSON.stringify(event));
    expect(result).toEqual(event);
    expect(parser.getToolsUsed()).toEqual(['grep_search']);
  });

  it('treats assistant_complete as the terminal result (OpenHarness 0.1.9 emits no `result` event)', () => {
    const event = {
      type: 'assistant_complete',
      summary: 'Implemented the feature',
      files_changed: ['a.ts', { file: 'b.ts' }],
    };
    parser.parseLine(JSON.stringify(event));

    expect(parser.getResult()).toEqual({
      type: 'result',
      status: 'COMPLETED',
      summary: 'Implemented the feature',
      files_changed: ['a.ts', { file: 'b.ts' }],
    });
    expect(parser.getFilesChanged()).toEqual(['a.ts', 'b.ts']);
  });

  it('falls back to assistant_complete `text` when no `summary` is present', () => {
    parser.parseLine(JSON.stringify({ type: 'assistant_complete', text: 'Blue and green.' }));

    expect(parser.getResult()).toMatchObject({ status: 'COMPLETED', summary: 'Blue and green.' });
  });

  it('ignores empty assistant_complete events', () => {
    parser.parseLine(JSON.stringify({ type: 'assistant_complete', text: '' }));

    expect(parser.getResult()).toBeNull();
  });

  it('turns OpenHarness error events into failed results', () => {
    parser.parseLine(JSON.stringify({ type: 'error', message: 'wrapper failed' }));

    expect(parser.getResult()).toMatchObject({
      status: 'FAILED',
      error_message: 'wrapper failed',
    });
  });

  it('accumulates tools used from tool_started events', () => {
    parser.parseLine(JSON.stringify({ type: 'tool_started', tool_name: 'Bash' }));
    parser.parseLine(JSON.stringify({ type: 'tool_started', name: 'Read' }));

    expect(parser.getToolsUsed()).toEqual(['Bash', 'Read']);
  });

  it('lets a real `result` event override a prior assistant_complete', () => {
    parser.parseLine(JSON.stringify({ type: 'assistant_complete', text: 'done' }));
    parser.parseLine(JSON.stringify({ type: 'result', status: 'FAILED', error_message: 'boom' }));

    expect(parser.getResult()).toMatchObject({ status: 'FAILED', error_message: 'boom' });
  });

  it('should ignore non-JSON noise', () => {
    const result = parser.parseLine('some random noise line');
    expect(result).toBeNull();
  });

  // Claude Code runtime (scripts/claude-run-skill.sh) emits a `result` event with
  // a different shape than oh: { subtype, is_error, result } and no `status`.
  it('normalizes a successful Claude Code result event', () => {
    parser.parseLine(
      JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'All done.' }),
    );

    expect(parser.getResult()).toMatchObject({
      status: 'COMPLETED',
      summary: 'All done.',
    });
  });

  it('normalizes a failed Claude Code result event (is_error true)', () => {
    parser.parseLine(
      JSON.stringify({
        type: 'result',
        subtype: 'error_max_turns',
        is_error: true,
      }),
    );

    expect(parser.getResult()).toMatchObject({
      status: 'FAILED',
      error_message: 'error_max_turns',
    });
  });

  it('accumulates tool_use names from a Claude Code assistant event', () => {
    parser.parseLine(
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Calling a tool' },
            { type: 'tool_use', name: 'mcp__bmad__bmad', input: {} },
          ],
        },
      }),
    );

    expect(parser.getToolsUsed()).toEqual(['mcp__bmad__bmad']);
  });

  it('splits a Claude result usage block into input (incl. cache) and output tokens', () => {
    parser.parseLine(
      JSON.stringify({
        type: 'result',
        is_error: false,
        result: 'done',
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_read_input_tokens: 10,
          service_tier: 'standard', // non-token field, ignored
        },
      }),
    );

    expect(parser.getTokensUsed()).toBe(160);
    expect(parser.getTokenUsage()).toEqual({ inputTokens: 110, outputTokens: 50 });
  });

  it('reads OpenAI (`oh` runtime) prompt/completion token vocabulary', () => {
    parser.parseLine(
      JSON.stringify({
        type: 'result',
        is_error: false,
        result: 'done',
        usage: { prompt_tokens: 200, completion_tokens: 80 },
      }),
    );

    expect(parser.getTokensUsed()).toBe(280);
    expect(parser.getTokenUsage()).toEqual({ inputTokens: 200, outputTokens: 80 });
  });

  it('reports zero tokens when the stream carries no usage block', () => {
    parser.parseLine(JSON.stringify({ type: 'result', status: 'COMPLETED', summary: 'done' }));

    expect(parser.getTokensUsed()).toBe(0);
    expect(parser.getTokenUsage()).toEqual({ inputTokens: null, outputTokens: null });
  });
});
