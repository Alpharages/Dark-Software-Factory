import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Dockerode from 'dockerode';
import { InfrastructureException } from '@/common/exceptions/infrastructure.exception';

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

  constructor(private readonly configService: ConfigService) {
    this.socketPath = this.configService.get<string>('DOCKER_SOCKET_PATH', '/var/run/docker.sock');
  }

  async onModuleInit(): Promise<void> {
    this.logger.log(`Initializing Docker client with socket: ${this.socketPath}`);

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
   */
  formatBindMount(hostPath: string, containerPath: string, mode: 'rw' | 'ro' = 'rw'): string {
    // Docker requires absolute paths
    // We assume the inputs are already resolved, but we can enforce simple validation
    if (!hostPath.startsWith('/') && !hostPath.match(/^[a-zA-Z]:\\/)) {
      this.logger.warn(`Host path '${hostPath}' does not appear to be absolute.`);
    }

    return `${hostPath}:${containerPath}:${mode}`;
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
