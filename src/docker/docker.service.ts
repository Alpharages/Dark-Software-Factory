import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import type { Gauge, Counter } from 'prom-client';
import Dockerode from 'dockerode';
import * as path from 'path';
import { InfrastructureException } from '@/common/exceptions/infrastructure.exception';
import {
  ResourceProfile,
  getResourceProfile,
  mbToBytes,
  cpuPercentToQuota,
} from './interfaces/resource-profile.interface';

export interface ContainerStreamOptions {
  /** Container ID to attach to */
  containerId: string;
  /** Stream stdout */
  stdout?: boolean;
  /** Stream stderr */
  stderr?: boolean;
  /** Stream stdin */
  stdin?: boolean;
  /** TTY mode - if true, stream is raw (no multiplexing) */
  tty?: boolean;
}

export interface ExecInContainerOptions {
  /** Container ID to execute in */
  containerId: string;
  /** Command to execute */
  command: string[];
  /** Attach stdout */
  attachStdout?: boolean;
  /** Attach stderr */
  attachStderr?: boolean;
  /** Attach stdin */
  attachStdin?: boolean;
  /** TTY mode */
  tty?: boolean;
  /** Environment variables */
  env?: string[];
  /** Working directory inside container */
  workingDir?: string;
}

export interface RunContainerOptions {
  /** Docker image to use */
  image: string;
  /** Command to run */
  command?: string[];
  /** Bind mounts */
  binds?: string[];
  /** Environment variables */
  env?: Record<string, string>;
  /** Working directory inside container */
  workingDir?: string;
  /** User to run as (e.g., 'agent' or '1000') */
  user?: string;
  /** TTY mode - should be true for interactive CLI tools */
  tty?: boolean;
  /** Auto-remove container on exit */
  autoRemove?: boolean;
  /** Container name */
  name?: string;
  /** Network mode */
  networkMode?: string;
  /** Memory limit in bytes (overrides profile and config) */
  memoryLimit?: number;
  /** CPU limit (percentage of single CPU, e.g., 1.5 = 1.5 CPUs) - overrides profile and config */
  cpuLimit?: number;
  /** Resource profile to use (small/medium/large/custom) - uses config defaults if not specified */
  resourceProfile?: ResourceProfile;
}

export interface ContainerExecResult {
  /** Exec instance ID */
  execId: string;
  /** Stream for I/O */
  stream: NodeJS.ReadWriteStream;
  /** Resize function (only valid if tty is true) */
  resize?: (w: number, h: number) => Promise<void>;
}

/**
 * DockerService provides programmatic control of the host Docker daemon
 * via dockerode. Implements the DooD (Docker-outside-of-Docker) pattern.
 */
@Injectable()
export class DockerService implements OnModuleInit {
  private readonly logger = new Logger(DockerService.name);
  private docker!: Dockerode;
  private connected = false;
  private socketPath: string;

  constructor(
    private readonly configService: ConfigService,
    @InjectMetric('sandbox_container_memory_limit_bytes')
    private readonly memoryLimitGauge: Gauge<string>,
    @InjectMetric('sandbox_container_cpu_limit_percent')
    private readonly cpuLimitGauge: Gauge<string>,
    @InjectMetric('sandbox_container_oom_events_total')
    private readonly oomCounter: Counter<string>,
    @InjectMetric('sandbox_container_cpu_throttled_seconds_total')
    private readonly cpuThrottledCounter: Counter<string>,
    @InjectMetric('sandbox_container_memory_usage_bytes')
    private readonly memoryUsageGauge: Gauge<string>,
  ) {
    this.socketPath = this.configService.get<string>('DOCKER_SOCKET_PATH', '/var/run/docker.sock');
  }

  async onModuleInit(): Promise<void> {
    // Log resource limit configuration at startup for debugging
    const memLimit = this.configService.get<number>(
      'sandbox.resourceLimits.defaultMemoryLimitMB',
      512,
    );
    const cpuLimit = this.configService.get<number>(
      'sandbox.resourceLimits.defaultCpuLimitPercent',
      100,
    );
    this.logger.log(
      `DockerService resource limits: memory=${memLimit}MB, cpu=${cpuLimit}% (socket: ${this.socketPath})`,
    );

    try {
      this.docker = new Dockerode({ socketPath: this.socketPath });
      await this.verifyConnection();
    } catch (error) {
      this.handleConnectionError(error);
    }
  }

  /**
   * Verify connection to Docker daemon by pinging it
   */
  private async verifyConnection(): Promise<void> {
    try {
      await this.docker.ping();
      this.connected = true;
      this.logger.log('✅ Docker daemon connection established');
    } catch (error) {
      this.connected = false;
      throw error;
    }
  }

  /**
   * Handle connection errors with descriptive messages
   */
  private handleConnectionError(error: unknown): void {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Check for common socket errors
    if (errorMessage.includes('ENOENT') || errorMessage.includes('no such file')) {
      this.logger.error(
        `❌ Docker socket not found at ${this.socketPath}. ` +
          'Ensure Docker is running and the socket path is correct.',
      );
    } else if (errorMessage.includes('EACCES') || errorMessage.includes('permission denied')) {
      this.logger.error(
        `❌ Permission denied accessing Docker socket at ${this.socketPath}. ` +
          'Ensure the container user has access to the docker group or run with appropriate permissions.',
      );
    } else if (errorMessage.includes('ECONNREFUSED')) {
      this.logger.error(
        `❌ Connection refused to Docker daemon at ${this.socketPath}. ` +
          'Ensure Docker is running and accepting connections.',
      );
    } else {
      this.logger.error(`❌ Failed to connect to Docker daemon: ${errorMessage}`);
    }

    // In production, this is critical; in development, we log and continue
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`Docker connection failed: ${errorMessage}`);
    } else {
      this.logger.warn('Continuing without Docker connection (development mode)...');
    }
  }

  /**
   * Check if Docker connection is healthy
   */
  async isHealthy(): Promise<boolean> {
    if (!this.docker) {
      return false;
    }

    try {
      await this.docker.ping();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if Docker client is connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * List running containers
   */
  async listContainers(all = false): Promise<Dockerode.ContainerInfo[]> {
    this.ensureConnected();

    try {
      return await this.docker.listContainers({ all });
    } catch (error) {
      this.logger.error('Failed to list containers:', error);
      throw error;
    }
  }

  /**
   * Create a new container
   * @param options Docker container creation options
   */
  async createContainer(options: Dockerode.ContainerCreateOptions): Promise<Dockerode.Container> {
    this.ensureConnected();

    try {
      this.logger.log(`Creating container with image: ${options.Image}`);

      // Log bind mounts if present
      if (options.HostConfig?.Binds) {
        this.logger.log(`Container binds: ${JSON.stringify(options.HostConfig.Binds)}`);
      }

      return await this.docker.createContainer(options);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to create container: ${errorMessage}`);
      throw new InfrastructureException(`Failed to create container: ${errorMessage}`, error);
    }
  }

  /**
   * Start a container
   * @param containerId Container ID or instance
   */
  async startContainer(containerId: string | Dockerode.Container): Promise<void> {
    this.ensureConnected();

    const container =
      typeof containerId === 'string' ? this.docker.getContainer(containerId) : containerId;

    try {
      this.logger.debug(
        `Starting container: ${typeof containerId === 'string' ? containerId : 'instance'}`,
      );
      await container.start();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to start container: ${errorMessage}`);
      throw new InfrastructureException(`Failed to start container: ${errorMessage}`, error);
    }
  }

  /**
   * Attach to a container's streams
   * @param options Container stream options
   * @returns Duplex stream for I/O
   */
  async attachContainer(options: ContainerStreamOptions): Promise<NodeJS.ReadWriteStream> {
    this.ensureConnected();

    const { containerId, stdout = true, stderr = true, stdin = true, tty = false } = options;

    try {
      this.logger.debug(`Attaching to container: ${containerId} (tty=${tty})`);

      const container = this.docker.getContainer(containerId);
      const stream = await container.attach({
        stream: true,
        stdout,
        stderr,
        stdin,
      });

      return stream as NodeJS.ReadWriteStream;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to attach to container: ${errorMessage}`);
      throw new InfrastructureException(`Failed to attach to container: ${errorMessage}`, error);
    }
  }

  /**
   * Ensure image exists locally, pull if needed
   * @param imageName Docker image name
   */
  private async ensureImage(imageName: string): Promise<void> {
    try {
      await this.docker.getImage(imageName).inspect();
      this.logger.debug(`Image ${imageName} exists locally`);
    } catch {
      this.logger.log(`Image ${imageName} not found locally, pulling...`);
      try {
        const stream = await this.docker.pull(imageName);
        // Wait for pull to complete
        await new Promise<void>((resolve, reject) => {
          this.docker.modem.followProgress(stream, (err: Error | null) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          });
        });
        this.logger.log(`Successfully pulled image ${imageName}`);
      } catch (pullError) {
        const errorMessage = pullError instanceof Error ? pullError.message : String(pullError);
        this.logger.error(`Failed to pull image ${imageName}: ${errorMessage}`);
        throw new InfrastructureException(
          `Failed to pull image ${imageName}: ${errorMessage}. ` +
            'Ensure the image exists and Docker daemon has internet access.',
          pullError,
        );
      }
    }
  }

  /**
   * Run a new container (create + start + attach in one flow)
   * Story 23.3: Resource Limit Enforcement - integrated config-based limits
   * @param options Container run options
   * @returns Object with container instance and stream
   */
  async runContainer(options: RunContainerOptions): Promise<{
    container: Dockerode.Container;
    stream: NodeJS.ReadWriteStream;
  }> {
    this.ensureConnected();

    const {
      image,
      command,
      binds = [],
      env = {},
      workingDir = '/home/agent/workspace',
      user = 'agent',
      tty = true,
      autoRemove = true,
      name,
      networkMode,
      memoryLimit: explicitMemoryLimit,
      cpuLimit: explicitCpuLimit,
      resourceProfile,
    } = options;

    try {
      // Ensure image exists before creating container
      await this.ensureImage(image);

      this.logger.log(`Running container with image: ${image}`);

      // Convert env record to array format
      const envArray = Object.entries(env).map(([key, value]) => `${key}=${value}`);

      // Build HostConfig
      const hostConfig: Dockerode.HostConfig = {
        Binds: binds,
        AutoRemove: autoRemove,
      };

      if (networkMode) {
        hostConfig.NetworkMode = networkMode;
      }

      // Story 23.3: Apply resource limits from config, profile, or explicit values
      const resourceLimits = this.buildResourceLimits({
        explicitMemoryLimit,
        explicitCpuLimit,
        resourceProfile,
      });

      if (resourceLimits.memoryBytes > 0) {
        hostConfig.Memory = resourceLimits.memoryBytes;
        // Fix for Story 23.3: MemorySwap is Total (RAM + Swap)
        // If swapBytes > 0, we add it to memoryBytes to get total limit
        // If swapBytes == 0, we set it equal to memoryBytes to disable swap
        // If swapBytes < 0, we set it to -1 (Unlimited swap)
        if (resourceLimits.swapBytes < 0) {
          hostConfig.MemorySwap = -1;
        } else {
          hostConfig.MemorySwap =
            resourceLimits.swapBytes > 0
              ? resourceLimits.memoryBytes + resourceLimits.swapBytes
              : resourceLimits.memoryBytes;
        }
        hostConfig.OomKillDisable = resourceLimits.oomKillDisable;

        this.logger.log(
          `Container ${name || '(unnamed)'} resource limits - Memory: ${hostConfig.Memory} bytes, ` +
            `MemorySwap: ${hostConfig.MemorySwap} bytes`,
        );
      }

      if (resourceLimits.cpuQuota > 0) {
        hostConfig.CpuQuota = resourceLimits.cpuQuota;
        hostConfig.CpuPeriod = resourceLimits.cpuPeriod;
      }

      const createOptions: Dockerode.ContainerCreateOptions = {
        Image: image,
        Cmd: command,
        Env: envArray,
        WorkingDir: workingDir,
        User: user,
        Tty: tty,
        OpenStdin: true, // Required for PTY
        AttachStdout: true,
        AttachStderr: true,
        AttachStdin: true,
        HostConfig: hostConfig,
      };

      if (name) {
        createOptions.name = name;
      }

      // Log resource limits for auditability (Story 23.3 AC)
      if (resourceLimits.memoryBytes > 0 || resourceLimits.cpuQuota > 0) {
        this.logger.log(
          `Container ${name || '(unnamed)'} resource limits - Memory: ${resourceLimits.memoryBytes} bytes, ` +
            `CPU Quota: ${resourceLimits.cpuQuota}, Period: ${resourceLimits.cpuPeriod}`,
        );

        // Record metrics
        const profileLabel = options.resourceProfile || 'config_default';
        this.memoryLimitGauge.set({ profile: profileLabel }, resourceLimits.memoryBytes);
        this.cpuLimitGauge.set(
          { profile: profileLabel },
          Math.round((resourceLimits.cpuQuota / resourceLimits.cpuPeriod) * 100),
        );
      }

      // Create and start container
      const container = await this.createContainer(createOptions);
      await this.startContainer(container);

      // Attach to streams
      const stream = await this.attachContainer({
        containerId: container.id,
        stdout: true,
        stderr: true,
        stdin: true,
        tty,
      });

      return { container, stream };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to run container: ${errorMessage}`);
      throw new InfrastructureException(`Failed to run container: ${errorMessage}`, error);
    }
  }

  /**
   * Build resource limits from configuration, profile, or explicit values
   * Story 23.3: Resource Limit Enforcement
   */
  private buildResourceLimits(options: {
    explicitMemoryLimit?: number;
    explicitCpuLimit?: number;
    resourceProfile?: ResourceProfile;
  }): {
    memoryBytes: number;
    swapBytes: number;
    cpuQuota: number;
    cpuPeriod: number;
    oomKillDisable: boolean;
  } {
    // Check if resource limits are enabled
    const limitsEnabled = this.configService.get<boolean>('sandbox.resourceLimits.enabled', true);

    if (!limitsEnabled) {
      this.logger.debug('Resource limits disabled via configuration');
      return {
        memoryBytes: 0,
        swapBytes: 0,
        cpuQuota: 0,
        cpuPeriod: 100000,
        oomKillDisable: false,
      };
    }

    let memoryMB: number;
    let cpuPercent: number;
    let swapMB: number;

    // Priority 1: Explicit values override everything
    if (options.explicitMemoryLimit && options.explicitMemoryLimit > 0) {
      memoryMB = Math.round(options.explicitMemoryLimit / (1024 * 1024));
      // Use explicit CPU if provided, otherwise fall back to config (not hardcoded 100%)
      cpuPercent = options.explicitCpuLimit
        ? Math.round(options.explicitCpuLimit * 100)
        : this.configService.get<number>('sandbox.resourceLimits.defaultCpuLimitPercent', 100);
      // Use configured swap limit instead of mirroring memory (which could waste resources)
      swapMB = this.configService.get<number>('sandbox.resourceLimits.defaultSwapLimitMB', 512);
      this.logger.debug(
        `Using explicit resource limits: memory=${memoryMB}MB, cpu=${cpuPercent}%, swap=${swapMB}MB`,
      );
    }
    // Priority 2: Resource profile (if specified and not 'custom')
    else if (options.resourceProfile && options.resourceProfile !== 'custom') {
      const profile = getResourceProfile(options.resourceProfile);
      memoryMB = profile.memoryLimitMB;
      cpuPercent = profile.cpuLimitPercent;
      swapMB = profile.swapLimitMB;
      this.logger.debug(`Using resource profile: ${options.resourceProfile}`);
    }
    // Priority 3: Config defaults
    else {
      memoryMB = this.configService.get<number>('sandbox.resourceLimits.defaultMemoryLimitMB', 512);
      cpuPercent = this.configService.get<number>(
        'sandbox.resourceLimits.defaultCpuLimitPercent',
        100,
      );
      swapMB = this.configService.get<number>('sandbox.resourceLimits.defaultSwapLimitMB', 512);
      this.logger.log(
        `Using config default resource limits: memory=${memoryMB}MB, cpu=${cpuPercent}%, swap=${swapMB}MB`,
      );
    }

    // Convert to Docker API format
    const { cpuQuota, cpuPeriod } = cpuPercentToQuota(cpuPercent);

    return {
      memoryBytes: mbToBytes(memoryMB),
      swapBytes: mbToBytes(swapMB),
      cpuQuota,
      cpuPeriod,
      oomKillDisable: false, // Allow OOM killer (security > availability)
    };
  }

  /**
   * Execute a command in a running container
   * @param options Execution options
   * @returns Exec result with stream and resize function
   */
  async execInContainer(options: ExecInContainerOptions): Promise<ContainerExecResult> {
    this.ensureConnected();

    const {
      containerId,
      command,
      attachStdout = true,
      attachStderr = true,
      attachStdin = true,
      tty = true,
      env = [],
      workingDir,
    } = options;

    try {
      this.logger.debug(`Executing command in container ${containerId}: ${command.join(' ')}`);

      const container = this.docker.getContainer(containerId);

      const execOptions: Dockerode.ExecCreateOptions = {
        Cmd: command,
        AttachStdout: attachStdout,
        AttachStderr: attachStderr,
        AttachStdin: attachStdin,
        Tty: tty,
        Env: env,
      };

      if (workingDir) {
        execOptions.WorkingDir = workingDir;
      }

      const exec = await container.exec(execOptions);

      // Start the exec instance
      const stream = await exec.start({
        hijack: true,
        stdin: attachStdin,
      });

      // Return resize function if TTY is enabled
      const resize = tty
        ? async (w: number, h: number): Promise<void> => {
            try {
              await exec.resize({ w, h });
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : String(error);
              this.logger.error(`Failed to resize exec: ${errorMessage}`);
              throw new InfrastructureException(`Failed to resize exec: ${errorMessage}`, error);
            }
          }
        : undefined;

      return {
        execId: exec.id,
        stream: stream as NodeJS.ReadWriteStream,
        resize,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to exec in container: ${errorMessage}`);
      throw new InfrastructureException(`Failed to exec in container: ${errorMessage}`, error);
    }
  }

  /**
   * Resize an exec instance (for TTY resizing)
   * @param execId Exec instance ID
   * @param w Width (columns)
   * @param h Height (rows)
   */
  async resizeExec(execId: string, w: number, h: number): Promise<void> {
    this.ensureConnected();

    try {
      const exec = this.docker.getExec(execId);
      await exec.resize({ w, h });
      this.logger.debug(`Resized exec ${execId} to ${w}x${h}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to resize exec: ${errorMessage}`);
      throw new InfrastructureException(`Failed to resize exec: ${errorMessage}`, error);
    }
  }

  /**
   * Wait for a container to finish and get exit code
   * @param containerId Container ID
   * @returns Exit code
   */
  async waitForContainer(containerId: string): Promise<{ StatusCode: number }> {
    this.ensureConnected();

    try {
      const container = this.docker.getContainer(containerId);
      return await container.wait();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to wait for container: ${errorMessage}`);
      throw new InfrastructureException(`Failed to wait for container: ${errorMessage}`, error);
    }
  }

  /**
   * Kill a running container
   * @param containerId Container ID
   * @param signal Signal to send (default: SIGKILL)
   */
  async killContainer(containerId: string, signal?: string): Promise<void> {
    this.ensureConnected();

    try {
      const container = this.docker.getContainer(containerId);
      await container.kill({ signal });
      this.logger.debug(`Killed container ${containerId} with signal ${signal || 'SIGKILL'}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      // Container might already be stopped - log but don't throw
      this.logger.warn(`Failed to kill container ${containerId}: ${errorMessage}`);
    }
  }

  /**
   * Remove a container
   * @param containerId Container ID
   * @param force Force removal even if running
   */
  async removeContainer(containerId: string, force = false): Promise<void> {
    this.ensureConnected();

    try {
      const container = this.docker.getContainer(containerId);
      await container.remove({ force });
      this.logger.debug(`Removed container ${containerId} (force=${force})`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to remove container ${containerId}: ${errorMessage}`);
    }
  }

  /**
   * Get the Dockerode instance for advanced operations
   */
  getDocker(): Dockerode {
    this.ensureConnected();
    return this.docker;
  }

  /**
   * Get the configured socket path
   */
  getSocketPath(): string {
    return this.socketPath;
  }

  /**
   * Helper to format a bind mount string (HostPath:ContainerPath:Mode)
   * Ensures paths are absolute and format is correct.
   * Supports both Unix and Windows paths.
   */
  formatBindMount(hostPath: string, containerPath: string, mode: 'rw' | 'ro' = 'rw'): string {
    // Check if path is absolute (cross-platform)
    const isWindows = process.platform === 'win32';
    const pathModule = isWindows ? path.win32 : path.posix;

    if (!pathModule.isAbsolute(hostPath)) {
      this.logger.warn(`Host path '${hostPath}' does not appear to be absolute.`);
    }

    // Normalize path separators for Windows (convert \ to / for Docker)
    const normalizedHostPath = isWindows ? hostPath.replace(/\\/g, '/') : hostPath;

    return `${normalizedHostPath}:${containerPath}:${mode}`;
  }

  /**
   * Record an OOM event for a container
   * Story 23.3: Resource Limit Enforcement
   * @param executionId Execution ID for labeling
   */
  recordOomEvent(executionId: string): void {
    this.oomCounter.inc({ execution_id: executionId });
    this.logger.warn(`[${executionId}] Container OOM event recorded`);
  }

  /**
   * Record CPU throttled time for a container
   * Story 23.3: Resource Limit Enforcement
   * @param executionId Execution ID for labeling
   * @param seconds Number of seconds CPU was throttled
   */
  recordCpuThrottled(executionId: string, seconds: number): void {
    this.cpuThrottledCounter.inc({ execution_id: executionId }, seconds);
  }

  /**
   * Update memory usage gauge for a container
   * Story 23.3: Resource Limit Enforcement
   * @param executionId Execution ID for labeling
   * @param bytes Memory usage in bytes
   */
  updateMemoryUsage(executionId: string, bytes: number): void {
    this.memoryUsageGauge.set({ execution_id: executionId }, bytes);
  }

  /**
   * Inspect container and update resource metrics
   * Story 23.3: Resource Limit Enforcement
   * @param containerId Container ID to inspect
   * @param executionId Execution ID for labeling
   */
  async updateResourceMetrics(containerId: string, executionId: string): Promise<void> {
    try {
      const container = this.docker.getContainer(containerId);
      const stats = await container.stats({ stream: false });

      // Update memory usage
      if (stats.memory_stats?.usage) {
        this.updateMemoryUsage(executionId, stats.memory_stats.usage);
      }

      // Check for CPU throttling
      if (stats.cpu_stats?.throttling_data?.throttled_time) {
        const throttledNanos = stats.cpu_stats.throttling_data.throttled_time;
        const throttledSeconds = throttledNanos / 1e9;
        if (throttledSeconds > 0) {
          this.recordCpuThrottled(executionId, throttledSeconds);
        }
      }
    } catch (error) {
      // Silently ignore - metrics are best-effort
      this.logger.debug(`Failed to update resource metrics for ${executionId}: ${error}`);
    }
  }

  /**
   * Ensure Docker client is connected before operations
   */
  private ensureConnected(): void {
    if (!this.docker || !this.connected) {
      throw new Error('Docker client not connected. Check socket path and Docker daemon status.');
    }
  }
}
