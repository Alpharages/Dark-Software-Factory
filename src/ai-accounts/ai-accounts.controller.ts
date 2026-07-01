import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { JwtAuthGuard } from '@/common/guards/auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { Role } from '@/auth/constants/roles.enum';
import { AiAccountsService } from './ai-accounts.service';
import { SetAiAccountEnabledDto } from './dto/set-enabled.dto';

/**
 * ADMIN-guarded credential-pool admin API (Epic A / A4). All routes are served under the global
 * `/api/v1/` prefix. No route ever returns or accepts plaintext credentials over the wire.
 */
@ApiTags('AI Accounts')
@ApiBearerAuth()
@Controller('admin/ai-accounts')
@UseGuards(JwtAuthGuard, RolesGuard, ThrottlerGuard)
export class AiAccountsController {
  constructor(private readonly accounts: AiAccountsService) {}

  // ponytail: the CSV rides in the multipart file buffer (`file.buffer`), never in
  // `request.body`, so the global LoggingInterceptor (which only logs request.body) never sees
  // credential bytes — no per-route body-log opt-out needed (AC3).
  @Post('import')
  @Roles(Role.ADMIN)
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary: 'Import AI accounts from a CSV (ADMIN). Import-only, encrypted at rest.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Account CSV (see docs/examples/ai-accounts.example.csv)',
        },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Import summary: counts + redacted per-row errors' })
  async import(@UploadedFile() file?: Express.Multer.File) {
    if (!file?.buffer) {
      throw new BadRequestException('CSV file is required (multipart field "file").');
    }
    return this.accounts.importFromCsv(file.buffer);
  }

  @Get()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'List pool accounts (ADMIN). Credentials are never returned.' })
  @ApiResponse({ status: 200, description: 'Redacted account list' })
  async list() {
    return this.accounts.list();
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Enable/disable an account (ADMIN).' })
  @ApiResponse({ status: 200, description: 'Updated redacted account' })
  async setEnabled(@Param('id') id: string, @Body() dto: SetAiAccountEnabledDto) {
    return this.accounts.setEnabled(id, dto.enabled);
  }
}
