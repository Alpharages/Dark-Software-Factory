import { Global, Module, forwardRef } from '@nestjs/common';
import { SandboxService } from './sandbox.service';
import { ExecutionModule } from '@/execution/execution.module';

@Global()
@Module({
  imports: [forwardRef(() => ExecutionModule)],
  providers: [SandboxService],
  exports: [SandboxService],
})
export class SandboxModule {}
