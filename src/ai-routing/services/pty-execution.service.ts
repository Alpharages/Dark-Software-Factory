import { Injectable, Logger } from '@nestjs/common';
import { spawn as nodeSpawn, ChildProcess } from 'child_process';

/**
 * PTY Execution Service
 *
 * Manages pseudo-terminal process execution for AI-driven code operations.
 * Provides spawn methods with comprehensive logging for observability.
 */
@Injectable()
export class PtyExecutionService {
  private readonly logger = new Logger(PtyExecutionService.name);

  /**
   * Spawn a PTY process
   * @param command The command to execute
   * @param args Arguments for the command
   * @param options Spawn options
   * @returns The spawned child process
   */
  spawn(command: string, args?: string[], options?: any): ChildProcess {
    const commandStr = args ? `${command} ${args.join(' ')}` : command;
    this.logger.log(`Spawning PTY process: ${commandStr}`);

    return nodeSpawn(command, args, options);
  }

  /**
   * Spawn a PTY process inside a container
   * @param command The command to execute
   * @param args Arguments for the command
   * @param containerId The container ID or name
   * @param options Spawn options
   * @returns The spawned child process
   */
  spawnInContainer(
    command: string,
    args?: string[],
    containerId?: string,
    options?: any,
  ): ChildProcess {
    const commandStr = args ? `${command} ${args.join(' ')}` : command;
    const containerInfo = containerId ? ` in container ${containerId}` : '';
    this.logger.log(`Spawning PTY process${containerInfo}: ${commandStr}`);

    // Execute command inside container using docker exec
    if (containerId) {
      const dockerArgs = ['exec', '-it', containerId, command, ...(args || [])];
      return nodeSpawn('docker', dockerArgs, options);
    }

    // Fallback to regular spawn if no container specified
    return nodeSpawn(command, args, options);
  }
}
