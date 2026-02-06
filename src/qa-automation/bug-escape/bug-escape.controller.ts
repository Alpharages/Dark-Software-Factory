import { Controller, Get, Query, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { BugEscapeService } from './bug-escape.service';
import { BugEscapeQueryDto } from './dto/bug-escape-query.dto';
import { QualityTrendsQueryDto } from './dto/quality-trends-query.dto';
import { EscapeRateResponseDto } from './dto/escape-rate-response.dto';
import { ThrottlerGuard } from '@nestjs/throttler';
// Assuming existing roles guard
import { RolesGuard } from '@/common/guards';
// import { Roles } from '../../auth/decorators/roles.decorator';
// import { Role } from '../../auth/enums/role.enum';

@ApiTags('QA Metrics')
@Controller('qa-metrics')
@UseGuards(ThrottlerGuard, RolesGuard)
export class BugEscapeController {
  constructor(private readonly bugEscapeService: BugEscapeService) {}

  @Get('bug-escapes')
  @ApiOperation({ summary: 'Get bug escape metrics and rates' })
  @ApiResponse({ status: 200, type: EscapeRateResponseDto })
  async getBugEscapes(@Query() query: BugEscapeQueryDto) {
    return this.bugEscapeService.calculateEscapeRate(query);
  }

  @Get('bug-escapes/:id')
  @ApiOperation({ summary: 'Get bug escape details' })
  async getEscapeDetails(@Param('id') id: string) {
    return this.bugEscapeService.getEscapeDetails(id);
  }

  @Get('quality-trends')
  @ApiOperation({ summary: 'Get quality trends over time' })
  async getQualityTrends(@Query() query: QualityTrendsQueryDto) {
    return this.bugEscapeService.getQualityTrends(query);
  }

  @Get('provider-comparison')
  @ApiOperation({ summary: 'Compare AI provider performance' })
  async getProviderComparison() {
    return this.bugEscapeService.compareProviders();
  }
}
