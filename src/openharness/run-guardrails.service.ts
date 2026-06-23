import { Injectable } from '@nestjs/common';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const FORMATTABLE_EXTENSIONS = new Set([
  '.css',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.scss',
  '.ts',
  '.tsx',
  '.yaml',
  '.yml',
]);

const ENV_REF_PATTERN = /\$\{([A-Z0-9_]+)\}/g;

export interface FormatOwnFilesResult {
  formattedFiles: string[];
}

@Injectable()
export class OpenHarnessRunGuardrailsService {
  findMissingMandatedMcpServers(mcpConfigPath: string, mandatedServers: string[]): string[] {
    const mandated = mandatedServers.map((server) => server.trim()).filter(Boolean);
    if (mandated.length === 0) return [];

    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const config = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8')) as {
        mcpServers?: Record<string, unknown>;
      };
      const servers = config.mcpServers ?? {};

      return mandated.filter((server) => !this.hasConfiguredServer(servers, server));
    } catch {
      return mandated;
    }
  }

  async formatOwnFiles(
    workspaceDir: string,
    filesChanged: string[],
    enabled: boolean,
    formatCommand: string,
  ): Promise<FormatOwnFilesResult> {
    if (!enabled || filesChanged.length === 0) return { formattedFiles: [] };

    const targets = this.formatTargets(workspaceDir, filesChanged);
    if (targets.length === 0) return { formattedFiles: [] };

    const [command, ...baseArgs] = formatCommand.trim().split(/\s+/).filter(Boolean);
    if (!command) return { formattedFiles: [] };

    await this.spawnFormatter(command, [...baseArgs, ...targets], workspaceDir);
    return { formattedFiles: targets };
  }

  private hasConfiguredServer(servers: Record<string, unknown>, server: string): boolean {
    const config = Object.entries(servers).find(([name]) => name === server)?.[1];
    if (!config) return false;

    const envRefs = [...JSON.stringify(config).matchAll(ENV_REF_PATTERN)].map((match) => match[1]);
    return envRefs.every((envName) => {
      // eslint-disable-next-line security/detect-object-injection
      return Boolean(process.env[envName]);
    });
  }

  private formatTargets(workspaceDir: string, filesChanged: string[]): string[] {
    const root = path.resolve(workspaceDir);
    const targets = new Set<string>();

    for (const file of filesChanged) {
      const absolutePath = path.resolve(root, file);
      const relativePath = path.relative(root, absolutePath);
      if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) continue;

      const basename = path.basename(absolutePath);
      if (
        basename === 'package-lock.json' ||
        basename === 'pnpm-lock.yaml' ||
        basename === 'yarn.lock' ||
        !FORMATTABLE_EXTENSIONS.has(path.extname(absolutePath))
      ) {
        continue;
      }

      if (
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        !fs.existsSync(absolutePath) ||
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        !fs.statSync(absolutePath).isFile()
      ) {
        continue;
      }
      targets.add(absolutePath);
    }

    return [...targets];
  }

  private spawnFormatter(command: string, args: string[], cwd: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd, stdio: 'ignore' });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) {
          resolve();
          return;
        }

        reject(new Error(`Formatter exited with code ${code}`));
      });
    });
  }
}
