import { Controller, Get, Post, Put, Body, Param, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AiCapabilityService } from './ai-capability.service';
import { PatternDetectorService } from './pattern-detector.service';
import {
  CreateLimitationDto,
  UpdateLimitationDto,
  CapabilityDashboardResponseDto,
} from './dtos/capability.dto';
import { TaskType } from '@/prisma/client';

@ApiTags('AI Capabilities')
@Controller('api/v1/capabilities')
export class CapabilitiesController {
  private readonly logger = new Logger(CapabilitiesController.name);

  constructor(
    private readonly capabilityService: AiCapabilityService,
    private readonly patternDetector: PatternDetectorService,
  ) {}

  /**
   * Get dashboard data with capability metrics and top limitations
   * Story 7.7 AC#1
   */
  @Get('dashboard')
  @ApiOperation({ summary: 'Get AI capability dashboard data' })
  @ApiResponse({
    status: 200,
    description: 'Dashboard data retrieved',
    type: CapabilityDashboardResponseDto,
  })
  async getDashboard(): Promise<CapabilityDashboardResponseDto> {
    this.logger.log('Fetching capability dashboard data');

    const capabilities = await this.capabilityService.getCapabilityMetrics();

    // Calculate trends (simplified - compare success rate to 50% baseline)
    const capabilitiesWithTrends = capabilities.map((cap) => ({
      taskType: cap.taskType,
      successRate: cap.successRate,
      trend: (cap.successRate > 50 ? 'UP' : cap.successRate < 50 ? 'DOWN' : 'STABLE') as
        | 'UP'
        | 'DOWN'
        | 'STABLE',
    }));

    // Get top limitations (failure rate > 40%)
    const topLimitations = capabilities
      .filter((cap) => cap.successRate < 60) // Less than 60% success = limitation
      .map((cap) => ({
        taskType: cap.taskType,
        failureRate: Math.round((100 - cap.successRate) * 100) / 100,
        knownIssues: cap.knownIssues,
        workaround: cap.workaround,
        isDisabled: cap.isDisabled,
      }))
      .sort((a, b) => b.failureRate - a.failureRate)
      .slice(0, 5); // Top 5 limitations

    return {
      capabilities: capabilitiesWithTrends,
      topLimitations,
    };
  }

  /**
   * Create a new AI limitation entry
   * Story 7.7 AC#1, AC#3
   */
  @Post('limitations')
  @ApiOperation({ summary: 'Document a new AI limitation' })
  @ApiResponse({ status: 201, description: 'Limitation created' })
  async createLimitation(
    @Body() dto: CreateLimitationDto,
  ): Promise<{ success: boolean; message: string }> {
    this.logger.log(`Creating limitation for task type: ${dto.taskType}`);

    await this.capabilityService.updateLimitations(
      dto.taskType,
      dto.knownIssues,
      dto.workaround,
      dto.isDisabled,
    );

    return {
      success: true,
      message: `Limitation documented for ${dto.taskType}`,
    };
  }

  /**
   * Update an existing AI limitation
   * Story 7.7 AC#1, AC#3
   */
  @Put('limitations/:taskType')
  @ApiOperation({ summary: 'Update AI limitation and workarounds' })
  @ApiResponse({ status: 200, description: 'Limitation updated' })
  async updateLimitation(
    @Param('taskType') taskType: string,
    @Body() dto: UpdateLimitationDto,
  ): Promise<{ success: boolean; message: string }> {
    this.logger.log(`Updating limitation for task type: ${taskType}`);

    // Validate task type
    if (!Object.values(TaskType).includes(taskType as TaskType)) {
      throw new Error(`Invalid task type: ${taskType}`);
    }

    await this.capabilityService.updateLimitations(
      taskType as TaskType,
      dto.knownIssues,
      dto.workaround,
      dto.isDisabled,
    );

    return {
      success: true,
      message: `Limitation updated for ${taskType}`,
    };
  }

  /**
   * Get AI limitations knowledge base in Markdown format
   * Story 7.7 AC#3
   */
  @Get('knowledge-base.md')
  @ApiOperation({ summary: 'Get AI limitations as Markdown documentation' })
  @ApiResponse({ status: 200, description: 'Knowledge base retrieved', type: String })
  async getKnowledgeBase(): Promise<string> {
    this.logger.log('Generating AI limitations knowledge base');

    const capabilities = await this.capabilityService.getCapabilityMetrics();

    // Generate Markdown document
    let markdown = `# AI Capabilities and Limitations Knowledge Base\n\n`;
    markdown += `> **Last Updated**: ${new Date().toISOString()}\n\n`;
    markdown += `This document describes known AI capabilities, limitations, and recommended workarounds.\n\n`;

    markdown += `## Summary\n\n`;
    markdown += `| Task Type | Success Rate | Status |\n`;
    markdown += `|-----------|--------------|--------|\n`;

    capabilities.forEach((cap) => {
      const status = cap.isDisabled
        ? '❌ Disabled'
        : cap.successRate >= 70
          ? '✅ Reliable'
          : cap.successRate >= 50
            ? '⚠️ Moderate'
            : '🔴 Problematic';

      markdown += `| ${cap.taskType} | ${cap.successRate.toFixed(1)}% | ${status} |\n`;
    });

    markdown += `\n## Detailed Limitations\n\n`;

    capabilities
      .filter((cap) => cap.knownIssues || cap.workaround || cap.isDisabled)
      .forEach((cap) => {
        markdown += `### ${cap.taskType}\n\n`;
        markdown += `**Success Rate**: ${cap.successRate.toFixed(1)}%\n\n`;

        if (cap.isDisabled) {
          markdown += `**Status**: ⛔ AI is disabled for this task type\n\n`;
        }

        if (cap.knownIssues) {
          markdown += `**Known Issues**:\n${cap.knownIssues}\n\n`;
        }

        if (cap.workaround) {
          markdown += `**Recommended Workaround**:\n${cap.workaround}\n\n`;
        }

        markdown += `---\n\n`;
      });

    markdown += `## Best Practices\n\n`;
    markdown += `1. Review this document before assigning tasks to AI\n`;
    markdown += `2. For disabled task types, use manual implementation\n`;
    markdown += `3. Report new patterns to TL for documentation\n`;
    markdown += `4. Success rates are updated daily based on execution history\n\n`;

    return markdown;
  }

  /**
   * Manually trigger pattern analysis (for testing/debugging)
   */
  @Post('analyze-patterns')
  @ApiOperation({ summary: 'Manually trigger pattern detection analysis' })
  @ApiResponse({ status: 200, description: 'Analysis triggered' })
  async triggerPatternAnalysis(): Promise<{ success: boolean; patternsDetected: number }> {
    this.logger.log('Manually triggering pattern analysis');

    const patterns = await this.patternDetector.triggerAnalysis();

    return {
      success: true,
      patternsDetected: patterns.length,
    };
  }
}
