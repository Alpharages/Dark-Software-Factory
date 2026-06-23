import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as child_process from 'child_process';
import { OpenHarnessRunGuardrailsService } from './run-guardrails.service';

jest.mock('child_process');

/* eslint-disable security/detect-non-literal-fs-filename */

describe('OpenHarnessRunGuardrailsService', () => {
  let service: OpenHarnessRunGuardrailsService;
  let workspaceDir: string;
  const envBackup = { ...process.env };

  beforeEach(() => {
    service = new OpenHarnessRunGuardrailsService();
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oh-guardrails-'));
    process.env = { ...envBackup };
  });

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
    process.env = { ...envBackup };
    jest.clearAllMocks();
  });

  it('reports mandated MCP servers missing when absent or env-backed config is incomplete', () => {
    const configPath = path.join(workspaceDir, 'mcp-config.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        mcpServers: {
          bmad: { url: '${BMAD_SERVER_URL}/mcp' },
          gitnexus: { url: '${GITNEXUS_SERVER_URL}/mcp' },
        },
      }),
    );
    process.env.BMAD_SERVER_URL = 'http://bmad.local';

    expect(service.findMissingMandatedMcpServers(configPath, ['bmad', 'gitnexus'])).toEqual([
      'gitnexus',
    ]);
  });

  it('formats only existing formattable changed files inside the workspace', async () => {
    const child = new EventEmitter() as any;
    (child_process.spawn as jest.Mock).mockReturnValue(child);

    fs.mkdirSync(path.join(workspaceDir, 'src'));
    fs.writeFileSync(path.join(workspaceDir, 'src/a.ts'), 'const a=1');
    fs.writeFileSync(path.join(workspaceDir, 'untouched.ts'), 'const untouched=1');
    fs.writeFileSync(path.join(workspaceDir, 'pnpm-lock.yaml'), 'lockfileVersion: 9');

    const resultPromise = service.formatOwnFiles(
      workspaceDir,
      ['src/a.ts', 'missing.ts', '../outside.ts', 'pnpm-lock.yaml'],
      true,
      'pnpm exec prettier --write',
    );
    child.emit('close', 0);

    await expect(resultPromise).resolves.toEqual({
      formattedFiles: [path.join(workspaceDir, 'src/a.ts')],
    });
    expect(child_process.spawn).toHaveBeenCalledWith(
      'pnpm',
      ['exec', 'prettier', '--write', path.join(workspaceDir, 'src/a.ts')],
      { cwd: workspaceDir, stdio: 'ignore' },
    );
    expect(fs.readFileSync(path.join(workspaceDir, 'untouched.ts'), 'utf8')).toBe(
      'const untouched=1',
    );
  });

  it('does not spawn formatter when formatting is disabled or no changed file qualifies', async () => {
    await expect(
      service.formatOwnFiles(workspaceDir, ['missing.ts'], false, 'pnpm exec prettier --write'),
    ).resolves.toEqual({ formattedFiles: [] });

    expect(child_process.spawn).not.toHaveBeenCalled();
  });
});
