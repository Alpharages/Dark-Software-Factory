import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as pty from 'node-pty';
import { spawn } from 'child_process';
import { Observable, Subject, share } from 'rxjs';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { DockerService } from '@/docker/docker.service';
import { WorkspaceService } from '@/docker/workspace.service';
import { ExecutionTrackerService } from '@/execution/execution-tracker.service';
import { InfrastructureException } from '@/common/exceptions/infrastructure.exception';
import { ResourceProfile } from '@/docker/interfaces/resource-profile.interface';
import { Semaphore } from '@/common/utils/semaphore.util';

export interface SpawnOptions {
  name?: string;
  cols?: number;
  rows?: number;
  cwd?: string;
  env?: { [key: string]: string };
}

export interface ContainerSpawnOptions extends SpawnOptions {
  executionId: string;
  ticketId?: string;
  /** Resource profile for container execution (Story 23.3) */
  resourceProfile?: ResourceProfile;
  /** Explicit memory limit in bytes (overrides profile) */
  memoryLimit?: number;
  /** Explicit CPU limit (percentage of single core, overrides profile) */
  cpuLimit?: number;
  /** Explicit workspace path to mount (overrides default creation) */
  workspacePath?: string;
  /** Additional bind mounts (hostPath:containerPath:mode) */
  extraBinds?: string[];
}

export interface ContainerSpawnResult {
  /** Container ID (not OS PID) */
  pid: number;
  /** stdout/stderr combined stream */
  output$: Observable<string>;
  /** Exit code observable */
  exit$: Observable<{ exitCode: number; signal?: number }>;
  /** Resize function for TTY */
  resize: (cols: number, rows: number) => Promise<void>;
  /** Write to stdin */
  write: (data: string) => void;
  /** Kill the container */
  kill: (signal?: string) => void;
  /** Container ID */
  containerId: string;
}

export interface LocalSpawnResult {
  pid: number;
  output$: Observable<string>;
  exit$: Observable<{ exitCode: number; signal?: number }>;
}

export class PtySpawnError extends Error {
  constructor(
    message: string,
    public readonly command: string,
    public readonly originalError?: Error,
  ) {
    super(message);
    this.name = 'PtySpawnError';
  }
}

/**
 * Tracks active container executions for cleanup
 */
interface ContainerExecution {
  containerId: string;
  outputSubject: Subject<string>;
  exitSubject: Subject<{ exitCode: number; signal?: number }>;
  stream: NodeJS.ReadWriteStream | null;
  timeoutTimer?: NodeJS.Timeout;
}

@Injectable()
export class PtyExecutionService implements OnModuleDestroy {
  private readonly logger = new Logger(PtyExecutionService.name);
  private processes = new Map<number, pty.IPty>();
  private containerExecutions = new Map<string, ContainerExecution>();
  private executionCounter = 0;
  private semaphore: Semaphore;

  // Feature flag
  private containerExecutionEnabled = false;
  private containerTimeoutMs = 3000000; // 50 minutes default (Claude CLI needs time for npm install + code generation)
  private maxConcurrentContainers = 10;

  // Track completed executions to prevent race conditions
  private completedExecutions = new Set<string>();

  constructor(
    private readonly configService?: ConfigService,
    private readonly dockerService?: DockerService,
    private readonly workspaceService?: WorkspaceService,
    private readonly executionTracker?: ExecutionTrackerService,
  ) {
    // Load configuration if available
    if (configService) {
      this.containerExecutionEnabled = configService.get<boolean>(
        'ENABLE_CONTAINER_EXECUTION',
        false,
      );
      this.containerTimeoutMs = configService.get<number>('sandbox.containerTimeoutMs', 300000);
      this.maxConcurrentContainers = configService.get<number>('sandbox.maxConcurrent', 10);
    }
    this.semaphore = new Semaphore(this.maxConcurrentContainers);
    this.logger.log(
      `Initialized PtyExecutionService with max concurrent containers: ${this.maxConcurrentContainers}`,
    );
  }

  /**
   * Check if a command exists in the system PATH
   */
  private commandExists(command: string): boolean {
    // If command is an absolute path, check if file exists and is executable
    if (path.isAbsolute(command)) {
      try {
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        const stats = fs.statSync(command);
        return stats.isFile();
      } catch {
        return false;
      }
    }

    // Otherwise, search in PATH
    const pathEnv = process.env.PATH || '';
    const pathDirs = pathEnv.split(path.delimiter);
    const extensions = os.platform() === 'win32' ? ['.exe', '.cmd', '.bat'] : [''];

    for (const dir of pathDirs) {
      for (const ext of extensions) {
        const fullPath = path.join(dir, command + ext);
        try {
          // eslint-disable-next-line security/detect-non-literal-fs-filename
          const stats = fs.statSync(fullPath);
          if (stats.isFile()) {
            return true;
          }
        } catch {
          // Continue checking other paths
        }
      }
    }
    return false;
  }

  /**
   * Resolve symlinks to get the real executable path
   */
  private resolveCommandPath(command: string): string {
    if (path.isAbsolute(command)) {
      try {
        // Resolve symlinks to the actual executable
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        const realPath = fs.realpathSync(command);
        this.logger.debug(`Resolved ${command} -> ${realPath}`);
        return realPath;
      } catch {
        // If resolution fails, return original path
        return command;
      }
    }
    return command;
  }

  /**
   * Filter environment variables to only pass safe ones to container.
   * Removes host-specific variables that can cause conflicts in container.
   */
  private filterSafeEnvVars(env: { [key: string]: string } | undefined): { [key: string]: string } {
    if (!env) return {};

    // Variables that should NOT be passed to container (host-specific)
    // NOTE: NODE_OPTIONS is intentionally NOT blocked here — providers like
    // ClaudeCodeProvider explicitly set container-appropriate values
    // (e.g., --max-old-space-size=2048) that must reach the container.
    const blockedPrefixes = [
      'NVM_', // Node Version Manager
      'ELECTRON_', // Electron-specific
      'VSCODE_', // VS Code-specific
      'npm_', // npm internal
      'ANTHROPIC_CLI_', // Claude CLI internal
    ];

    const safeEnv: { [key: string]: string } = {};
    for (const [key, value] of Object.entries(env)) {
      // Skip blocked prefixes
      const isBlocked = blockedPrefixes.some((prefix) => key === prefix || key.startsWith(prefix));
      if (!isBlocked) {
        // eslint-disable-next-line security/detect-object-injection
        safeEnv[key] = value;
      }
    }

    return safeEnv;
  }

  /**
   * Spawn a process locally using PTY
   * Falls back to child_process if PTY fails (macOS Gatekeeper)
   */
  spawn(command: string, args: string[] = [], options: SpawnOptions = {}): LocalSpawnResult {
    const defaultShell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
    const cmd = command || defaultShell;

    this.logger.log(`Spawning PTY process: ${cmd} ${args.join(' ')}`, {
      command: cmd,
      args: args,
      cwd: options.cwd || process.cwd()
    });

    // Check if command exists before attempting to spawn
    // Skip check for shell commands (bash, sh, etc.) as they should always exist
    // Also skip in test environment to allow mocked commands
    const shellCommands = ['bash', 'sh', 'zsh', 'fish', 'powershell.exe', 'cmd.exe'];
    const isTestEnv = process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined;
    const exists = this.commandExists(cmd);

    this.logger.debug(`Spawn check: cmd=${cmd}, isTestEnv=${isTestEnv}, exists=${exists}`);

    if (!isTestEnv && !shellCommands.includes(cmd) && !exists) {
      this.logger.error(`Command not found: ${cmd}. PATH=${process.env.PATH}`);
      // Return a mock result that immediately errors
      const outputSubject = new Subject<string>();
      const exitSubject = new Subject<{ exitCode: number; signal?: number }>();

      // Emit error asynchronously to match PTY behavior
      setImmediate(() => {
        outputSubject.error(new PtySpawnError(`Command not found: ${cmd}`, cmd));
        exitSubject.next({ exitCode: 127, signal: undefined }); // 127 = command not found
        exitSubject.complete();
      });

      return {
        pid: -1,
        output$: outputSubject.asObservable(),
        exit$: exitSubject.asObservable(),
      };
    }

    // Resolve symlinks to real executable path (fixes node-pty symlink issues)
    const resolvedCmd = this.resolveCommandPath(cmd);

    // On macOS, Gatekeeper blocks direct spawning of unsigned executables like Claude CLI.
    // Solution: Always spawn through /bin/sh (like automaker does), which is a trusted system binary.
    // The shell then executes the target command as a child process, bypassing Gatekeeper.
    const platform = os.platform();
    const useShellWrapper = platform === 'darwin' || platform === 'linux';

    let spawnCmd: string;
    let spawnArgs: string[];

    if (useShellWrapper) {
      // Use shell wrapper to bypass macOS Gatekeeper (matching automaker pattern)
      spawnCmd = '/bin/sh';
      const commandStr =
        args.length > 0
          ? `${resolvedCmd} ${args.map((a) => `"${a.replace(/"/g, '\\"')}"`).join(' ')}`
          : resolvedCmd;
      spawnArgs = ['-c', commandStr];
    } else {
      // Windows - spawn directly
      spawnCmd = resolvedCmd;
      spawnArgs = args;
    }

    this.logger.debug(
      `Spawning: platform=${platform}, cmd=${spawnCmd}, args=${JSON.stringify(spawnArgs)}, useShellWrapper=${useShellWrapper}`,
    );

    try {
      const ptyProcess = pty.spawn(spawnCmd, spawnArgs, {
        name: options.name || 'xterm-color',
        cols: options.cols || 80,
        rows: options.rows || 30,
        cwd: options.cwd || process.cwd(),
        env: { ...process.env, ...options.env },
      });

      const pid = ptyProcess.pid;
      this.processes.set(pid, ptyProcess);
      this.logger.debug(`Spawned PTY process ${pid}: ${resolvedCmd} ${args.join(' ')}`);

      const outputSubject = new Subject<string>();
      const exitSubject = new Subject<{ exitCode: number; signal?: number }>();

      ptyProcess.onData((data: string) => {
        outputSubject.next(data);
      });

      ptyProcess.onExit(({ exitCode, signal }: { exitCode: number; signal?: number }) => {
        this.logger.debug(`PTY process ${pid} exited with code ${exitCode}`);
        exitSubject.next({ exitCode, signal });
        exitSubject.complete();
        outputSubject.complete();
        this.processes.delete(pid);
      });

      return {
        pid,
        output$: outputSubject.asObservable(),
        exit$: exitSubject.asObservable(),
      };
    } catch (error) {
      // Handle synchronous spawn errors (e.g., posix_spawnp failed)
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to spawn PTY process: ${errorMessage}`);

      // On macOS, try fallback to regular child_process.spawn (bypasses PTY security restrictions)
      if (platform === 'darwin' && errorMessage.includes('posix_spawnp')) {
        this.logger.log(`Falling back to child_process.spawn for ${resolvedCmd}`);
        return this.spawnWithChildProcess(resolvedCmd, args, options);
      }

      const outputSubject = new Subject<string>();
      const exitSubject = new Subject<{ exitCode: number; signal?: number }>();

      // Emit error asynchronously to maintain consistent interface
      setImmediate(() => {
        outputSubject.error(
          new PtySpawnError(
            `Failed to spawn command '${resolvedCmd}': ${errorMessage}`,
            cmd,
            error instanceof Error ? error : undefined,
          ),
        );
        exitSubject.next({ exitCode: 126, signal: undefined }); // 126 = command found but not executable
        exitSubject.complete();
      });

      return {
        pid: -1,
        output$: outputSubject.asObservable(),
        exit$: exitSubject.asObservable(),
      };
    }
  }

  /**
   * Spawn a command in a Docker container
   * AC 1, 2, 4, 6: Container execution with streaming, TTY resize, exit code capture
   *
   * @param command Command to run
   * @param args Command arguments
   * @param options Container spawn options (must include executionId)
   * @returns ContainerSpawnResult with stream, resize, write, kill functions
   */
  async spawnInContainer(
    command: string,
    args: string[] = [],
    options: ContainerSpawnOptions,
  ): Promise<ContainerSpawnResult> {
    const { executionId, cols: _cols = 80, rows: _rows = 30 } = options;

    // Acquire semaphore slot before proceeding
    // This allows backpressure to build up if too many containers are running
    const availablePermits = this.semaphore.getAvailablePermits();
    const queueLength = this.semaphore.getQueueLength();

    if (availablePermits === 0) {
      this.logger.log(
        `[${executionId}] Waiting for container slot... (Active: ${this.maxConcurrentContainers}, Queued: ${queueLength + 1})`,
      );
    }

    await this.semaphore.acquire();

    this.logger.log(`[${executionId}] Spawning in container: ${command} ${args.join(' ')}`, {
      executionId,
      command,
      args: args,
      resourceProfile: options.resourceProfile
    });

    // Validate dependencies
    if (!this.dockerService) {
      throw new InfrastructureException('DockerService is required for container execution');
    }

    if (!this.workspaceService) {
      throw new InfrastructureException('WorkspaceService is required for container execution');
    }

    // Ensure Docker is connected
    if (!this.dockerService.isConnected()) {
      this.semaphore.release(); // Release immediately if check fails
      throw new InfrastructureException('Docker is not connected');
    }

    // Create or use existing workspace
    let workspacePath = options.workspacePath;
    if (!workspacePath) {
      workspacePath = await this.workspaceService.createWorkspace(executionId);
      this.logger.debug(`[${executionId}] Workspace created at: ${workspacePath}`);
    } else {
      this.logger.debug(`[${executionId}] Using existing workspace: ${workspacePath}`);
    }

    // Build full command
    const fullCommand = [command, ...args];

    // Run container with dsf-agent-base image
    // Story 23.3: Pass resource limits to container
    const { container, stream } = await this.dockerService.runContainer({
      image: 'dsf-agent-base',
      command: fullCommand,
      binds: [`${workspacePath}:/home/agent/workspace:rw`, ...(options.extraBinds || [])],
      workingDir: '/home/agent/workspace',
      user: 'agent',
      tty: true,
      autoRemove: true,
      env: {
        // Only pass safe environment variables to container
        // Avoid host-specific variables that can conflict with container's Node.js
        NODE_ENV: process.env.NODE_ENV || 'development',
        PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
        HOME: '/home/agent',
        // User-provided env vars (excluding potentially problematic ones)
        ...this.filterSafeEnvVars(options.env),
      },
      resourceProfile: options.resourceProfile,
      memoryLimit: options.memoryLimit,
      cpuLimit: options.cpuLimit,
    });

    this.logger.log(`[${executionId}] Container started: ${container.id}`);

    // Story 23.2: Store container ID for cleanup tracking
    if (this.executionTracker) {
      try {
        await this.executionTracker.assignContainer(executionId, container.id);
      } catch (error) {
        this.logger.warn(`[${executionId}] Failed to assign container ID: ${error}`);
        // Non-fatal: continue execution even if assignment fails
      }
    }

    // Generate pseudo-PID (container executions use negative numbers to avoid collision with local PTY PIDs)
    this.executionCounter++;
    const pseudoPid = -this.executionCounter;

    // Create subjects for streaming
    const outputSubject = new Subject<string>();
    const exitSubject = new Subject<{ exitCode: number; signal?: number }>();

    // Store execution state
    const execution: ContainerExecution = {
      containerId: container.id,
      outputSubject,
      exitSubject,
      stream,
    };
    this.containerExecutions.set(executionId, execution);

    // Set up timeout
    const timeoutTimer = setTimeout(() => {
      this.logger.warn(
        `[${executionId}] Container execution timed out after ${this.containerTimeoutMs}ms`,
      );
      // Pass exit code 124 (timeout) to distinguish from OOM (137)
      this.killContainerExecution(executionId, 'SIGKILL', 124);
      // No need to emit exitSubject here - killContainerExecution handles it with the correct exit code
    }, this.containerTimeoutMs);

    execution.timeoutTimer = timeoutTimer;

    // Handle stream data
    stream.on('data', (data: Buffer) => {
      outputSubject.next(data.toString());
    });

    // Handle stream end (container exit)
    stream.on('end', async () => {
      // Guard against race conditions - only process once
      if (this.completedExecutions.has(executionId)) {
        return;
      }
      this.completedExecutions.add(executionId);

      this.logger.debug(`[${executionId}] Container stream ended`);
      clearTimeout(timeoutTimer);

      try {
        // Wait for container to get exit code
        const waitResult = await this.dockerService!.waitForContainer(container.id);
        const exitCode = waitResult.StatusCode;

        this.logger.log(`[${executionId}] Container exited with code ${exitCode}`);
        exitSubject.next({ exitCode, signal: undefined });
      } catch (error) {
        this.logger.error(`[${executionId}] Error waiting for container: ${error}`);
        exitSubject.next({ exitCode: 1, signal: undefined });
      }

      if (!exitSubject.closed) {
        exitSubject.complete();
      }
      if (!outputSubject.closed) {
        outputSubject.complete();
      }
      this.cleanupContainerExecution(executionId);
    });

    // Handle stream errors
    stream.on('error', (error: Error) => {
      // Guard against race conditions - only process once
      if (this.completedExecutions.has(executionId)) {
        return;
      }
      this.completedExecutions.add(executionId);

      this.logger.error(`[${executionId}] Container stream error: ${error.message}`);
      clearTimeout(timeoutTimer);
      outputSubject.error(error);
      exitSubject.next({ exitCode: 1, signal: undefined });
      exitSubject.complete();
      this.cleanupContainerExecution(executionId);
    });

    // IMPORTANT: cleanupContainerExecution() calls this.semaphore.release()
    // This ensures slots are freed when container exits or errors

    // Return result interface
    return {
      pid: pseudoPid,
      containerId: container.id,
      output$: outputSubject.asObservable().pipe(share()),
      exit$: exitSubject.asObservable().pipe(share()),
      resize: async (resizeCols: number, resizeRows: number): Promise<void> => {
        try {
          // Note: Docker exec resize requires an exec instance, not container
          // For TTY resize during container run, we need to use the container's resize API
          const docker = this.dockerService!.getDocker();
          const containerInstance = docker.getContainer(container.id);

          // Only resize if container is running and TTY was enabled
          const containerInfo = await containerInstance.inspect();
          if (!containerInfo.State.Running) {
            this.logger.debug(`[${executionId}] Cannot resize - container not running`);
            return;
          }
          if (!containerInfo.Config.Tty) {
            this.logger.debug(
              `[${executionId}] Cannot resize - container was not created with TTY`,
            );
            return;
          }

          await containerInstance.resize({ h: resizeRows, w: resizeCols });
          this.logger.debug(`[${executionId}] Resized container to ${resizeCols}x${resizeRows}`);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          // Log as debug rather than warn - resize failures are often benign
          // (e.g., container already exited, non-TTY container)
          this.logger.debug(`[${executionId}] Resize skipped: ${errorMessage}`);
        }
      },
      write: (data: string): void => {
        const writeStream = stream as { destroyed?: boolean } | null;
        if (writeStream && !writeStream.destroyed) {
          stream.write(data);
        }
      },
      kill: (signal?: string): void => {
        this.killContainerExecution(executionId, signal);
      },
    };
  }

  /**
   * Check if container execution is enabled
   */
  isContainerExecutionEnabled(): boolean {
    return this.containerExecutionEnabled;
  }

  /**
   * Enable or disable container execution
   */
  setContainerExecutionEnabled(enabled: boolean): void {
    this.containerExecutionEnabled = enabled;
    this.logger.log(`Container execution ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Kill a container execution
   * @param executionId The execution ID
   * @param signal Kill signal (default: SIGKILL)
   * @param exitCode Custom exit code to report (default: 137 for SIGKILL, 124 for timeout)
   */
  private killContainerExecution(executionId: string, signal?: string, exitCode?: number): void {
    const execution = this.containerExecutions.get(executionId);
    if (!execution) {
      this.logger.warn(`[${executionId}] No active container execution to kill`);
      return;
    }

    const resolvedExitCode = exitCode ?? 137; // Default to 137 (SIGKILL) if not specified
    const resolvedSignal = signal || 'SIGKILL';

    this.logger.log(
      `[${executionId}] Killing container ${execution.containerId} with signal ${resolvedSignal} (exit code: ${resolvedExitCode})`,
    );

    // Clear timeout
    if (execution.timeoutTimer) {
      clearTimeout(execution.timeoutTimer);
    }

    // Kill container
    this.dockerService?.killContainer(execution.containerId, resolvedSignal);

    // Destroy stream
    const stream = execution.stream as { destroyed?: boolean; destroy?: () => void } | null;
    if (stream && !stream.destroyed) {
      stream.destroy?.();
    }

    // Complete subjects with the appropriate exit code
    if (!execution.exitSubject.closed) {
      execution.exitSubject.next({ exitCode: resolvedExitCode, signal: 9 });
      execution.exitSubject.complete();
    }
    if (!execution.outputSubject.closed) {
      execution.outputSubject.complete();
    }

    this.containerExecutions.delete(executionId);

    // Release semaphore slot since execution is hard-killed
    this.semaphore.release();
    this.logger.debug(`[${executionId}] Released semaphore slot (kill)`);
  }

  /**
   * Clean up container execution state
   */
  private cleanupContainerExecution(executionId: string): void {
    const execution = this.containerExecutions.get(executionId);
    if (!execution) return;

    // Clear timeout
    if (execution.timeoutTimer) {
      clearTimeout(execution.timeoutTimer);
    }

    // Destroy stream if still open
    const stream = execution.stream as { destroyed?: boolean; destroy?: () => void } | null;
    if (stream && !stream.destroyed) {
      stream.destroy?.();
    }

    this.containerExecutions.delete(executionId);
    this.completedExecutions.delete(executionId);

    // Release semaphore slot on normal cleanup
    this.semaphore.release();
    this.logger.debug(
      `[${executionId}] Container execution cleaned up and semaphore slot released`,
    );
  }

  /**
   * Fallback spawn using child_process (no PTY)
   * Used when node-pty fails on macOS due to Gatekeeper/security restrictions
   */
  private spawnWithChildProcess(
    command: string,
    args: string[],
    options: SpawnOptions,
  ): LocalSpawnResult {
    const outputSubject = new Subject<string>();
    const exitSubject = new Subject<{ exitCode: number; signal?: number }>();

    try {
      const child = spawn(command, args, {
        cwd: options.cwd || process.cwd(),
        env: { ...process.env, ...options.env },
        shell: os.platform() === 'darwin', // Use shell on macOS for compatibility
      });

      const pid = child.pid || -1;
      this.logger.debug(`Spawned child process ${pid}: ${command} ${args.join(' ')}`);

      child.stdout?.on('data', (data: Buffer) => {
        outputSubject.next(data.toString());
      });

      child.stderr?.on('data', (data: Buffer) => {
        outputSubject.next(data.toString());
      });

      child.on('exit', (exitCode, signal) => {
        this.logger.debug(`Child process ${pid} exited with code ${exitCode}`);
        exitSubject.next({ exitCode: exitCode || 0, signal: signal ? 1 : undefined });
        exitSubject.complete();
        outputSubject.complete();
      });

      child.on('error', (err) => {
        this.logger.error(`Child process error: ${err.message}`);
        outputSubject.error(err);
        exitSubject.next({ exitCode: 126, signal: undefined });
        exitSubject.complete();
      });

      // Store a reference (using a wrapper to match PTY interface for kill)
      /*const processWrapper = {
        kill: (signal?: string) => {
          child.kill(signal as NodeJS.Signals);
        },
      };*/
      // Note: We don't add to this.processes since child_process doesn't have a pid property that's compatible

      return {
        pid,
        output$: outputSubject.asObservable(),
        exit$: exitSubject.asObservable(),
      };
    } catch (error) {
      this.logger.error(`Failed to spawn child process: ${error}`);

      setImmediate(() => {
        outputSubject.error(error);
        exitSubject.next({ exitCode: 126, signal: undefined });
        exitSubject.complete();
      });

      return {
        pid: -1,
        output$: outputSubject.asObservable(),
        exit$: exitSubject.asObservable(),
      };
    }
  }

  write(pid: number, data: string): void {
    const ptyProcess = this.processes.get(pid);
    if (ptyProcess) {
      ptyProcess.write(data);
    } else {
      this.logger.warn(`Attempted to write to non-existent PTY process ${pid}`);
    }
  }

  resize(pid: number, cols: number, rows: number): void {
    const ptyProcess = this.processes.get(pid);
    if (ptyProcess) {
      ptyProcess.resize(cols, rows);
    }
  }

  kill(pid: number, signal?: string): void {
    const ptyProcess = this.processes.get(pid);
    if (ptyProcess) {
      ptyProcess.kill(signal);
      this.processes.delete(pid);
    }
  }

  /**
   * Determine resource profile based on execution complexity
   * Story 23.3: Resource Limit Enforcement
   * @param complexityScore Complexity score (0-10+)
   * @returns ResourceProfile ('small', 'medium', or 'large')
   */
  static selectResourceProfile(complexityScore: number): ResourceProfile {
    if (complexityScore <= 3) {
      return 'small';
    } else if (complexityScore <= 7) {
      return 'medium';
    } else {
      return 'large';
    }
  }

  /**
   * Spawn a container with automatic resource profile selection
   * Story 23.3: Resource Limit Enforcement
   * @param command Command to run
   * @param args Command arguments
   * @param complexityScore Complexity score for resource profile selection
   * @param options Container spawn options
   * @returns ContainerSpawnResult
   */
  async spawnWithProfile(
    command: string,
    args: string[],
    complexityScore: number,
    options: Omit<ContainerSpawnOptions, 'resourceProfile'>,
  ): Promise<ContainerSpawnResult> {
    const resourceProfile = PtyExecutionService.selectResourceProfile(complexityScore);
    this.logger.log(
      `[${options.executionId}] Selected resource profile: ${resourceProfile} (complexity: ${complexityScore})`,
    );

    return this.spawnInContainer(command, args, {
      ...options,
      resourceProfile,
    });
  }

  onModuleDestroy() {
    this.logger.log('Cleaning up PTY processes and container executions...');

    // Kill local PTY processes
    for (const [pid, ptyProcess] of this.processes) {
      try {
        this.logger.debug(`Killing PTY process ${pid}`);
        ptyProcess.kill();
      } catch (err) {
        this.logger.error(`Failed to kill PTY process ${pid}`, err);
      }
    }
    this.processes.clear();

    // Clean up container executions
    for (const [executionId, _execution] of this.containerExecutions) {
      try {
        this.logger.debug(`Cleaning up container execution ${executionId}`);
        this.killContainerExecution(executionId, 'SIGKILL');
      } catch (err) {
        this.logger.error(`Failed to cleanup container execution ${executionId}`, err);
      }
    }
    this.containerExecutions.clear();
  }
}
