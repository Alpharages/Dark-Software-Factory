import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DockerService } from './docker.service';
import { WorkspaceService } from './workspace.service';

/**
 * DockerModule provides Docker daemon integration via dockerode.
 *
 * This module implements the DooD (Docker-outside-of-Docker) pattern,
 * allowing the NestJS Orchestrator to control the host Docker daemon
 * by mounting the Docker socket.
 */
@Module({
  imports: [ConfigModule],
  providers: [DockerService, WorkspaceService],
  exports: [DockerService, WorkspaceService],
})
export class DockerModule {}
