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

  it('should ignore non-JSON noise', () => {
    const result = parser.parseLine('some random noise line');
    expect(result).toBeNull();
  });
});
