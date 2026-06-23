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
});
