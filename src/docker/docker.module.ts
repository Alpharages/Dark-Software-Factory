import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { makeGaugeProvider, makeCounterProvider } from '@willsoto/nestjs-prometheus';
import { DockerService } from './docker.service';
import { WorkspaceService } from './workspace.service';

/**
 * Story 23.3: Resource Limit Metrics
 * Prometheus metrics for container resource limits and events
 */
const resourceLimitMetricProviders = [
  makeGaugeProvider({
    name: 'sandbox_container_memory_limit_bytes',
    help: 'Configured memory limit per container',
    labelNames: ['profile'],
  }),
  makeGaugeProvider({
    name: 'sandbox_container_cpu_limit_percent',
    help: 'Configured CPU limit percentage per container',
    labelNames: ['profile'],
  }),
  makeCounterProvider({
    name: 'sandbox_container_oom_events_total',
    help: 'Total number of container OOM events',
    labelNames: ['execution_id'],
  }),
  makeCounterProvider({
    name: 'sandbox_container_cpu_throttled_seconds_total',
    help: 'Total time CPU was throttled per container',
    labelNames: ['execution_id'],
  }),
  makeGaugeProvider({
    name: 'sandbox_container_memory_usage_bytes',
    help: 'Current memory usage per container',
    labelNames: ['execution_id'],
  }),
];

/**
 * DockerModule provides Docker daemon integration via dockerode.
 *
 * This module implements the DooD (Docker-outside-of-Docker) pattern,
 * allowing the NestJS Orchestrator to control the host Docker daemon
 * by mounting the Docker socket.
 */
@Module({
  imports: [ConfigModule],
  providers: [DockerService, WorkspaceService, ...resourceLimitMetricProviders],
  exports: [DockerService, WorkspaceService],
})
export class DockerModule {}
