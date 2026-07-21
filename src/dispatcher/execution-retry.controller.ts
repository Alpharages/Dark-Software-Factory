import { Controller, Param, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@/auth/constants/roles.enum';
import { AuthenticatedUser } from '@/auth/interfaces/jwt-payload.interface';
import { Roles } from '@/common/decorators/roles.decorator';
import { JwtAuthGuard, RolesGuard } from '@/common/guards';
import { DispatcherService } from './dispatcher.service';

const RETRY_ROLES = [Role.ADMIN, Role.MANAGER, Role.PM, Role.TL];

/**
 * Retry lives here (in DispatcherModule) rather than ExecutionModule because it
 * calls DispatcherService, and ExecutionModule → DispatcherModule →
 * OpenHarnessModule → ExecutionModule would close an import cycle. Same reason
 * the dependency-release endpoint lives beside the dispatcher.
 */
@ApiTags('Execution')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('executions')
export class ExecutionRetryController {
  constructor(private readonly dispatcher: DispatcherService) {}

  @Post(':id/retry')
  @Roles(...RETRY_ROLES)
  @ApiOperation({ summary: 'Retry a terminal execution by re-running its implement skill' })
  @ApiParam({ name: 'id', description: 'Execution UUID' })
  @ApiResponse({ status: 201, description: 'Retry dispatched (or a reason it was not)' })
  retry(@Param('id') executionId: string, @Req() req: { user?: AuthenticatedUser }) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException('Authenticated user id is required to retry an execution');
    }
    return this.dispatcher.retryExecution(executionId, `retry-${userId}`);
  }
}
