import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as pty from 'node-pty';
import { Observable, Subject } from 'rxjs';
import * as os from 'os';

export interface SpawnOptions {
  name?: string;
  cols?: number;
  rows?: number;
  cwd?: string;
  env?: { [key: string]: string };
}

@Injectable()
export class PtyExecutionService implements OnModuleDestroy {
  private readonly logger = new Logger(PtyExecutionService.name);
  private processes = new Map<number, pty.IPty>();

  constructor() {}

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

    const ptyProcess = pty.spawn(cmd, args, {
      name: options.name || 'xterm-color',
      cols: options.cols || 80,
      rows: options.rows || 30,
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...options.env },
    });

    const pid = ptyProcess.pid;
    this.processes.set(pid, ptyProcess);
    this.logger.debug(`Spawned PTY process ${pid}: ${cmd} ${args.join(' ')}`);

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
