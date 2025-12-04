import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { exec, spawn } from 'child_process';
import * as path from 'path';
import { promisify } from 'util';
import { TEST_FRAMEWORK_CONFIG } from './interfaces/test-runner.interface';

const execAsync = promisify(exec);

export interface IDockerRunOptions {
  image: string;
  workspacePath: string;
  command: string;
  timeoutMs: number;
  correlationId: string;
  env?: Record<string, string>;
}

export interface IDockerRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

@Injectable()
export class DockerExecutorService {
  private readonly logger = new Logger(DockerExecutorService.name);
  private readonly defaultTimeoutMs: number;
  private readonly dockerMemoryLimit: string;
  private readonly dockerCpuLimit: string;

  constructor(private readonly configService: ConfigService) {
    this.defaultTimeoutMs = this.configService.get<number>('qa.testTimeoutMs', 300000);
    this.dockerMemoryLimit = this.configService.get<string>('qa.dockerMemoryLimit', '2g');
    this.dockerCpuLimit = this.configService.get<string>('qa.dockerCpuLimit', '2');
  }

  /**
   * Execute command in isolated Docker container
   * IMPORTANT: Workspace mounted read-write for test output files
   */
  async executeInContainer(options: IDockerRunOptions): Promise<IDockerRunResult> {
    const {
      image,
      workspacePath,
      command,
      timeoutMs = this.defaultTimeoutMs,
      correlationId,
      env = {},
    } = options;

    // Security: Validate workspace path
    if (!path.isAbsolute(workspacePath)) {
      throw new Error(`Invalid workspace path: ${workspacePath}`);
    }

    const startTime = Date.now();
    // Security: Use random suffix for container name
    const containerName = `dsf-test-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    // Build docker arguments array (NO SHELL INJECTION)
    const dockerArgs = [
      'run',
      '--rm',
      '--name',
      containerName,
      `--memory=${this.dockerMemoryLimit}`,
      `--cpus=${this.dockerCpuLimit}`,
      '--network=none', // Isolate network for security
      '-v',
      `${workspacePath}:/workspace:rw`, // READ-WRITE for test output
      '-w',
      '/workspace',
      ...Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
      image,
      '/bin/sh',
      '-c',
      command,
    ];

    this.logger.debug(`[${correlationId}] Executing Docker command with image: ${image}`);

    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      // Security: shell: false prevents command injection
      const child = spawn('docker', dockerArgs, {
        shell: false,
        timeout: timeoutMs,
      });

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      const timeout = setTimeout(async () => {
        timedOut = true;
        this.logger.warn(
          `[${correlationId}] Container ${containerName} timed out after ${timeoutMs}ms`,
        );

        try {
          await execAsync(`docker kill ${containerName}`);
        } catch {
          // Container may have already exited
        }

        child.kill('SIGKILL');
      }, timeoutMs);

      child.on('close', (code) => {
        clearTimeout(timeout);

        resolve({
          exitCode: code ?? (timedOut ? 124 : 1),
          stdout,
          stderr,
          timedOut,
          durationMs: Date.now() - startTime,
        });
      });

      child.on('error', (err) => {
        clearTimeout(timeout);
        this.logger.error(`[${correlationId}] Docker execution error: ${err.message}`);

        resolve({
          exitCode: 1,
          stdout,
          stderr: stderr + err.message,
          timedOut: false,
          durationMs: Date.now() - startTime,
        });
      });
    });
  }

  /**
   * Check if Docker is available on the host
   */
  async isDockerAvailable(): Promise<boolean> {
    try {
      await execAsync('docker info');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Pull Docker image if not already present
   */
  async ensureImage(image: string): Promise<void> {
    // Security: Validate image against whitelist
    const allowedImages = Object.values(TEST_FRAMEWORK_CONFIG).map((c) => c.dockerImage);
    if (!allowedImages.includes(image)) {
      throw new Error(`Security Error: Image ${image} is not in the allowed whitelist`);
    }

    try {
      await execAsync(`docker image inspect ${image}`);
    } catch {
      this.logger.log(`Pulling Docker image: ${image}`);
      await execAsync(`docker pull ${image}`);
    }
  }
}
