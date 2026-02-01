import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as pty from 'node-pty';
import { spawn, ChildProcess } from 'child_process';
import { Observable, Subject } from 'rxjs';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

export interface SpawnOptions {
  name?: string;
  cols?: number;
  rows?: number;
  cwd?: string;
  env?: { [key: string]: string };
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

@Injectable()
export class PtyExecutionService implements OnModuleDestroy {
  private readonly logger = new Logger(PtyExecutionService.name);
  private processes = new Map<number, pty.IPty>();

  constructor() {}

  /**
   * Check if a command exists in the system PATH
   */
  private commandExists(command: string): boolean {
    // If command is an absolute path, check if file exists and is executable
    if (path.isAbsolute(command)) {
      try {
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

  spawn(
    command: string,
    args: string[] = [],
    options: SpawnOptions = {},
  ): {
    pid: number;
    output$: Observable<string>;
    exit$: Observable<{ exitCode: number; signal?: number }>;
  } {
    const defaultShell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
    const cmd = command || defaultShell;

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
      const commandStr = args.length > 0 
        ? `${resolvedCmd} ${args.map(a => `"${a.replace(/"/g, '\\"')}"`).join(' ')}`
        : resolvedCmd;
      spawnArgs = ['-c', commandStr];
    } else {
      // Windows - spawn directly
      spawnCmd = resolvedCmd;
      spawnArgs = args;
    }
    
    this.logger.debug(`Spawning: platform=${platform}, cmd=${spawnCmd}, args=${JSON.stringify(spawnArgs)}, useShellWrapper=${useShellWrapper}`);

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
   * Fallback spawn using child_process (no PTY)
   * Used when node-pty fails on macOS due to Gatekeeper/security restrictions
   */
  private spawnWithChildProcess(
    command: string,
    args: string[],
    options: SpawnOptions,
  ): {
    pid: number;
    output$: Observable<string>;
    exit$: Observable<{ exitCode: number; signal?: number }>;
  } {
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
      const processWrapper = {
        kill: (signal?: string) => {
          child.kill(signal as NodeJS.Signals);
        },
      };
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

  onModuleDestroy() {
    this.logger.log('Cleaning up PTY processes...');
    for (const [pid, ptyProcess] of this.processes) {
      try {
        this.logger.debug(`Killing PTY process ${pid}`);
        ptyProcess.kill();
      } catch (err) {
        this.logger.error(`Failed to kill PTY process ${pid}`, err);
      }
    }
    this.processes.clear();
  }
}
