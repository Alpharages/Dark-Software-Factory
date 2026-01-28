import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '@/common/guards/auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Roles } from '@/common/decorators/roles.decorator';
import { Role } from '@/auth/constants/roles.enum';
import { ClickUpService } from '@/clickup/clickup.service';

@ApiTags('Integrations')
@ApiBearerAuth()
@Controller('integrations')
@UseGuards(JwtAuthGuard, RolesGuard, ThrottlerGuard)
export class IntegrationsController {
  private readonly logger = new Logger(IntegrationsController.name);

  constructor(private readonly clickupService: ClickUpService) {}

  @Get(':provider/hierarchy')
  @Roles(Role.PM, Role.MANAGER, Role.ADMIN)
  @ApiOperation({
    summary: 'Get provider hierarchy',
    description:
      'Fetches hierarchy (Spaces > Lists) from the integration provider for discovery. Currently supports "clickup".',
  })
  @ApiParam({
    name: 'provider',
    description: 'Integration provider name (case-insensitive)',
    example: 'clickup',
    enum: ['clickup'],
  })
  @ApiQuery({
    name: 'teamId',
    required: false,
    description:
      'ClickUp Team (Organization) ID to filter results. If omitted, returns all accessible organizations.',
    type: String,
  })
  @ApiResponse({ status: 200, description: 'Return hierarchy structure' })
  @ApiResponse({ status: 404, description: 'Provider not found' })
  async getHierarchy(@Param('provider') provider: string, @Query('teamId') teamId?: string) {
    const providerKey = provider.toLowerCase();

    if (providerKey === 'clickup') {
      return this.clickupService.getHierarchy({ teamId });
    }

    throw new NotFoundException(`Provider "${provider}" not supported`);
  }
}
