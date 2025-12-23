import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { JwtAuthGuard } from '@/common/guards/auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { Role } from '@/auth/constants/roles.enum';
import { FileLockManagerService } from './file-lock-manager.service';
import { FileLockWaitingQueryDto } from './dto/file-lock-waiting-query.dto';

@ApiTags('File Locks')
@ApiBearerAuth()
@Controller('api/v1/file-locks')
@UseGuards(JwtAuthGuard, RolesGuard, ThrottlerGuard)
export class FileLocksController {
  constructor(private readonly fileLocks: FileLockManagerService) {}

  @Get()
  @Roles(Role.PM, Role.TL, Role.QA, Role.MANAGER, Role.ADMIN)
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  @ApiOperation({ summary: 'List active file locks' })
  @ApiResponse({ status: 200, description: 'Active locks returned' })
  async listActiveLocks(): Promise<{
    locks: Array<{ filePath: string; ticketId: string; executionId: string; lockedAt: string }>;
    total: number;
  }> {
    const locks = await this.fileLocks.getActiveLocks();
    return { locks, total: locks.length };
  }

  @Get('waiting')
  @Roles(Role.PM, Role.TL, Role.QA, Role.MANAGER, Role.ADMIN)
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  @ApiOperation({ summary: 'List waiting file lock queue entries (grouped by file)' })
  @ApiResponse({ status: 200, description: 'Waiting queues returned' })
  async listWaitingQueues(@Query() query: FileLockWaitingQueryDto): Promise<{
    queues: Array<{
      filePath: string;
      estimatedReleaseTime?: string;
      tickets: Array<{
        ticketId: string;
        executionId: string;
        requestedAt: string;
        position: number;
      }>;
    }>;
    totalFiles: number;
    totalWaiting: number;
  }> {
    const { queues, totalWaiting } = await this.fileLocks.getWaitingQueues(query.filePath);
    return { queues, totalFiles: queues.length, totalWaiting };
  }
}
