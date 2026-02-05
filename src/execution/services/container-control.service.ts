import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Docker from 'dockerode';

/**
 * Service for controlling Docker containers during manual intervention
 * Story 10-U-5: Manual Intervention Circuit Breaker
 *
 * Provides methods to pause, resume, and stop containers during execution.
 * Container control failures are logged but don't block state transitions.
 */
@Injectable()
export class ContainerControlService {
  private readonly logger = new Logger(ContainerControlService.name);
  private readonly docker: Docker;

  constructor(private readonly configService: ConfigService) {
    const socketPath = this.configService.get<string>('DOCKER_SOCKET_PATH', '/var/run/docker.sock');
    this.docker = new Docker({ socketPath });
  }

  /**
   * Pause a running Docker container
   * Sends SIGSTOP to suspend all processes in the container
   *
   * @param containerId - Docker container ID
   * @returns true if successful, false otherwise
   */
  async pauseContainer(containerId: string): Promise<boolean> {
    try {
      const container = this.docker.getContainer(containerId);
      await container.pause();
      this.logger.log(`Container ${containerId} paused successfully`);
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      // Container might not exist or already be stopped - log warning but don't fail
      this.logger.warn(`Failed to pause container ${containerId}: ${errorMessage}`);
      return false;
    }
  }

  /**
   * Resume a paused Docker container
   * Sends SIGCONT to resume all processes in the container
   *
   * @param containerId - Docker container ID
   * @returns true if successful, false otherwise
   */
  async resumeContainer(containerId: string): Promise<boolean> {
    try {
      const container = this.docker.getContainer(containerId);
      await container.unpause();
      this.logger.log(`Container ${containerId} resumed successfully`);
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to resume container ${containerId}: ${errorMessage}`);
      return false;
    }
  }

  /**
   * Kill a Docker container immediately
   * Sends SIGKILL for immediate termination
   *
   * @param containerId - Docker container ID
   * @returns true if successful, false otherwise
   */
  async emergencyKillContainer(containerId: string): Promise<boolean> {
    try {
      const container = this.docker.getContainer(containerId);
      await container.kill({ signal: 'SIGKILL' });
      this.logger.log(`Container ${containerId} killed (SIGKILL) successfully`);
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to kill container ${containerId}: ${errorMessage}`);
      return false;
    }
  }

  /**
   * Gracefully stop a Docker container
   * Sends SIGTERM and waits for graceful shutdown
   *
   * @param containerId - Docker container ID
   * @param timeout - Timeout in seconds before force kill (default: 30)
   * @returns true if successful, false otherwise
   */
  async gracefulStopContainer(containerId: string, timeout = 30): Promise<boolean> {
    try {
      const container = this.docker.getContainer(containerId);
      await container.stop({ t: timeout });
      this.logger.log(`Container ${containerId} stopped gracefully (timeout: ${timeout}s)`);
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to gracefully stop container ${containerId}: ${errorMessage}`);
      return false;
    }
  }

  /**
   * Check if a container exists and is running
   *
   * @param containerId - Docker container ID
   * @returns Object with exists and running flags
   */
  async getContainerStatus(containerId: string): Promise<{ exists: boolean; running: boolean }> {
    try {
      const container = this.docker.getContainer(containerId);
      const info = await container.inspect();
      return {
        exists: true,
        running: info.State.Running && !info.State.Paused,
      };
    } catch {
      // Container doesn't exist
      return { exists: false, running: false };
    }
  }
}
