import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Query,
  Res,
  Logger,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/common/guards/auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Roles } from '@/common/decorators/roles.decorator';
import { Role } from '@/auth/constants/roles.enum';
import { ReportsService } from './reports.service';
import { GenerateReportDto } from './dto/generate-report.dto';
import type { Response, Request } from 'express';

@ApiTags('Reports')
@ApiBearerAuth()
@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard, ThrottlerGuard)
export class ReportsController {
  private readonly logger = new Logger(ReportsController.name);

  constructor(private readonly reportsService: ReportsService) {}

  @Post('sprint')
  @Roles(Role.PM, Role.TL, Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Generate or fetch a sprint report' })
  @ApiResponse({ status: 201, description: 'Report generated or fetched from cache' })
  async generateSprintReport(@Body() generateReportDto: GenerateReportDto, @Req() req: Request) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userId = (req as any).user?.id;
    this.logger.log(
      `Generating sprint report for project ${generateReportDto.project_id} by user ${userId}`,
    );
    return this.reportsService.generateSprintReport(generateReportDto, userId);
  }

  @Get(':id')
  @Roles(Role.PM, Role.TL, Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Get report details by ID' })
  @ApiResponse({ status: 200, description: 'Return report details' })
  @ApiResponse({ status: 404, description: 'Report not found' })
  async getReport(@Param('id') id: string, @Req() req: Request) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userId = (req as any).user?.id;
    return this.reportsService.getReport(id, userId);
  }

  @Get(':id/download')
  @Roles(Role.PM, Role.TL, Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Download report in PDF or PPTX format' })
  @ApiResponse({ status: 200, description: 'Report file stream' })
  async downloadReport(
    @Param('id') id: string,
    @Query('format') format: 'pdf' | 'pptx',
    @Res() res: Response,
    @Req() req: Request,
  ) {
    const userId = (req as unknown as { user: { id: string } }).user.id;
    this.logger.log(`Downloading report ${id} in ${format} format by user ${userId}`);
    const fileStream = await this.reportsService.getReportFileStream(id, format, userId);

    // Setting content-type based on format
    const contentType =
      format === 'pdf'
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    const fileName = `report-${id}.${format}`;

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);

    fileStream.pipe(res);
  }
}
