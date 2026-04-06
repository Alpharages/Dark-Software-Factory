import { Injectable, Logger } from '@nestjs/common';
import * as pty from 'node-pty';

/**
 * Interface for PTY spawn options
 */
export interface PtySpawnOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  cols?: number;
  rows?: number;
}

/**
 * Interface for container spawn options
 */
export interface ContainerSpawnOptions extends PtySpawnOptions {
  containerId: string;
  user?: string;
}

/**
 * Service for executing commands in PTY (pseudo-terminal) processes
 *
 * This service provides methods to spawn processes in a PTY environment,
 * both directly on the host and within containers.
 */
@Injectable()
export class PtyExecutionService {
  private readonly logger = new Logger(PtyExecutionService.name);

  /**
   * Spawns a command in a PTY process
   *
   * @param command - The command to execute
   * @param args - Array of command arguments
   * @param options - PTY spawn options
   * @returns The spawned PTY process
   *
   * @example
   * ```typescript
   * const process = this.ptyExecutionService.spawn('bash', ['-c', 'echo hello']);
   * ```
   */
  spawn(
    command: string,
    args: string[] = [],
    options: PtySpawnOptions = {},
  ): pty.IPty {
    // Log the command being executed for tracking purposes
    this.logger.log(
      `Spawning PTY process: ${command} ${args.join(' ')}`,
    );

    const ptyProcess = pty.spawn(command, args, {
      name: 'xterm-color',
      cols: options.cols || 80,
      rows: options.rows || 30,
      cwd: options.cwd || process.cwd(),
      env: options.env || process.env,
    });

    return ptyProcess;
  }

  /**
   * Spawns a command in a PTY process within a container
   *
   * This method executes a command inside a Docker container using PTY,
   * which preserves terminal capabilities and interactivity.
   *
   * @param command - The command to execute inside the container
   * @param args - Array of command arguments
   * @param options - Container spawn options including container ID
   * @returns The spawned PTY process
   *
   * @example
   * ```typescript
   * const process = this.ptyExecutionService.spawnInContainer(
   *   'bash',
   *   ['-c', 'npm test'],
   *   { containerId: 'my-container-id' }
   * );
   * ```
   */
  spawnInContainer(
    command: string,
    args: string[] = [],
    options: ContainerSpawnOptions,
  ): pty.IPty {
    const { containerId, user, ...ptyOptions } = options;

    // Build docker exec command
    const dockerArgs = ['exec', '-it'];

    if (user) {
      dockerArgs.push('-u', user);
    }

    dockerArgs.push(containerId, command, ...args);

    // Log the container command being executed for tracking purposes
    this.logger.log(
      `Spawning PTY process in container ${containerId}: ${command} ${args.join(' ')}`,
    );

    const ptyProcess = pty.spawn('docker', dockerArgs, {
      name: 'xterm-color',
      cols: ptyOptions.cols || 80,
      rows: ptyOptions.rows || 30,
      cwd: ptyOptions.cwd || process.cwd(),
      env: ptyOptions.env || process.env,
    });

    return ptyProcess;
  }

  /**
   * Kills a PTY process gracefully
   *
   * @param ptyProcess - The PTY process to kill
   */
  kill(ptyProcess: pty.IPty): void {
    try {
      ptyProcess.kill();
      this.logger.log('PTY process terminated successfully');
    } catch (error) {
      this.logger.error('Failed to kill PTY process', error);
      throw error;
    }
  }
}
