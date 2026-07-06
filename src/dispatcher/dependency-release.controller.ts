import { Controller, Param, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@/auth/constants/roles.enum';
import { AuthenticatedUser } from '@/auth/interfaces/jwt-payload.interface';
import { Roles } from '@/common/decorators/roles.decorator';
import { JwtAuthGuard, RolesGuard } from '@/common/guards';
import { DispatcherService } from './dispatcher.service';

const RELEASE_ROLES = [Role.ADMIN, Role.MANAGER, Role.PM];

@ApiTags('Dependency Release')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('dispatcher/dependencies')
export class DependencyReleaseController {
  constructor(private readonly dispatcher: DispatcherService) {}

  @Post(':ticketId/release')
  @Roles(...RELEASE_ROLES)
  @ApiOperation({ summary: 'Release a dependency-held ticket for guarded dispatch' })
  release(@Param('ticketId') ticketId: string, @Req() req: { user?: AuthenticatedUser }) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException('Authenticated user id is required to release a ticket');
    }
    return this.dispatcher.releaseDependencyHold(ticketId, `dependency-release-${userId}`);
  }
}
