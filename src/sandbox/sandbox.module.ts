import { Global, Module, forwardRef } from '@nestjs/common';
import {
  makeCounterProvider,
  makeGaugeProvider,
  makeHistogramProvider,
} from '@willsoto/nestjs-prometheus';
import { SandboxService } from './sandbox.service';
import { SandboxResourceProfileService } from './sandbox-resource-profile.service';
import { ExecutionModule } from '@/execution/execution.module';
import { AppMetricsModule } from '@/common/metrics/metrics.module';
import { SANDBOX_METRICS } from '@/common/metrics/metrics.constants';

const sandboxMetricProviders = [
  makeCounterProvider({
    name: SANDBOX_METRICS.EXECUTIONS_TOTAL,
    help: 'Total OpenSandbox executions by provider and status',
    labelNames: ['provider', 'status'],
  }),
  makeHistogramProvider({
    name: SANDBOX_METRICS.EXECUTION_DURATION_SECONDS,
    help: 'OpenSandbox execution duration in seconds',
    labelNames: ['provider'],
    buckets: [1, 5, 10, 30, 60, 120, 300, 600, 1800], // up to 30 min
  }),
  makeGaugeProvider({
    name: SANDBOX_METRICS.ACTIVE_SANDBOXES,
    help: 'Current number of active OpenSandbox sandboxes',
  }),
  makeGaugeProvider({
    name: SANDBOX_METRICS.CONCURRENCY_QUEUE_DEPTH,
    help: 'Number of runAgentCommand() calls waiting for a concurrency slot',
  }),
];

@Global()
@Module({
  imports: [AppMetricsModule, forwardRef(() => ExecutionModule)],
  providers: [SandboxService, SandboxResourceProfileService, ...sandboxMetricProviders],
  exports: [SandboxService, SandboxResourceProfileService],
})
export class SandboxModule {}
