import {
  Controller,
  Get,
  Patch,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../auth/constants/roles.enum';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AnomalyDetectionService } from './services/anomaly-detection.service';
import {
  AnomalyDto,
  AnomalyQueryDto,
  AnomalyResolutionDto,
  AnomalyConfigDto,
} from './dto/anomaly-detection.dto';

interface AuthenticatedRequest extends Request {
  user: {
    sub: string;
    [key: string]: unknown;
  };
}

@ApiTags('Quality Anomaly Detection')
@ApiBearerAuth()
@Controller('api/v1/qa-dashboard/anomalies')
@UseGuards(JwtAuthGuard, RolesGuard, ThrottlerGuard)
export class AnomalyDetectionController {
  constructor(private readonly anomalyDetectionService: AnomalyDetectionService) {}

  @Get()
  @Roles(Role.QA, Role.ADMIN)
  @ApiOperation({ summary: 'List detected quality anomalies' })
  @ApiResponse({ status: 200, type: [AnomalyDto] })
  async getAnomalies(@Query() query: AnomalyQueryDto): Promise<AnomalyDto[]> {
    return this.anomalyDetectionService.detectAnomalies(query);
  }

  @Patch(':id')
  @Roles(Role.QA, Role.ADMIN)
  @ApiOperation({ summary: 'Acknowledge or resolve an anomaly' })
  @ApiResponse({ status: 200, type: AnomalyDto })
  async resolveAnomaly(
    @Param('id') id: string,
    @Body() update: AnomalyResolutionDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<AnomalyDto> {
    return this.anomalyDetectionService.resolveAnomaly(id, update, req.user.sub);
  }

  @Post('trigger')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Manually trigger anomaly detection analysis' })
  @ApiResponse({ status: 200, description: 'Analysis triggered' })
  async triggerAnalysis() {
    await this.anomalyDetectionService.runScheduledAnalysis();
    return { status: 'triggered', timestamp: new Date() };
  }

  @Get('config')
  @Roles(Role.QA, Role.ADMIN)
  @ApiOperation({ summary: 'Get anomaly detection configuration' })
  @ApiResponse({ status: 200, type: AnomalyConfigDto })
  async getConfig(@Query('project_id') projectId?: string): Promise<AnomalyConfigDto> {
    return this.anomalyDetectionService.getAnomalyConfig(projectId);
  }

  @Post('config')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Update anomaly detection configuration' })
  @ApiResponse({ status: 200, type: AnomalyConfigDto })
  async updateConfig(
    @Body() update: AnomalyConfigDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<AnomalyConfigDto> {
    return this.anomalyDetectionService.updateAnomalyConfig(update, req.user.sub);
  }

  @Get('history')
  @Roles(Role.QA, Role.ADMIN)
  @ApiOperation({ summary: 'Get historical anomaly trends and reports' })
  @ApiResponse({ status: 200, description: 'Historical anomaly data' })
  async getHistory(
    @Query('project_id') projectId?: string,
    @Query('metric') metric?: string,
    @Query('period') period: string = '30d',
  ) {
    return this.anomalyDetectionService.getAnomalyHistory(projectId, metric, period);
  }
}
