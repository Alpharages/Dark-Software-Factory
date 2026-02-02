import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import { constants } from 'fs';
import * as path from 'path';
import { InfrastructureException } from '@/common/exceptions/infrastructure.exception';

@Injectable()
export class WorkspaceService {
  private readonly logger = new Logger(WorkspaceService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Creates a workspace directory for the given ticket ID.
   * Resolves the root path from config and ensures the directory exists.
   * Verify permissions after creation.
   *
   * @param ticketId - The ticket ID to create a workspace for
   * @returns The absolute path to the created workspace
   * @throws InfrastructureException if creation or permission verification fails
   */
  async createWorkspace(ticketId: string): Promise<string> {
    try {
      const root = this.config.get<string>(
        'SANDBOX_WORKSPACES_ROOT',
        path.join(process.cwd(), 'workspaces'),
      );
      const workspacesRoot = path.resolve(root);
      const workspacePath = path.join(workspacesRoot, ticketId);

      this.logger.log(`Creating workspace at ${workspacePath}`);

      // eslint-disable-next-line security/detect-non-literal-fs-filename
      await fs.mkdir(workspacePath, { recursive: true });
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      await fs.chmod(workspacePath, 0o777);

      // Verify permissions after creation to fail fast if we can't write
      await this.verifyPermissions(workspacePath);

      return workspacePath;
    } catch (error) {
      if (error instanceof InfrastructureException) {
        throw error;
      }
      throw new InfrastructureException(`Failed to create workspace for ticket ${ticketId}`, error);
    }
  }

  /**
   * Verifies that the Node process has read/write access to the path.
   *
   * @param dirPath - The path to verify
   * @throws InfrastructureException if access is denied
   */
  async verifyPermissions(dirPath: string): Promise<void> {
    try {
      await fs.access(dirPath, constants.R_OK | constants.W_OK);
    } catch (error) {
      this.logger.error(
        `Permission Verification Failed: ${dirPath}`,
        error instanceof Error ? error.stack : error,
      );
      throw new InfrastructureException(`Insufficient permissions for workspace ${dirPath}`, error);
    }
  }
}
