import { Controller, Get, Post, Put, Body, Param, Logger, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';
import { AiCapabilityService } from './ai-capability.service';
import { PatternDetectorService } from './pattern-detector.service';
import {
  CreateLimitationDto,
  UpdateLimitationDto,
  CapabilityDashboardResponseDto,
} from './dtos/capability.dto';
import { TaskType } from '@/prisma/client';

@ApiTags('AI Capabilities')
@ApiBearerAuth()
@UseGuards(ThrottlerGuard)
@Controller('capabilities')
export class CapabilitiesController {
  private readonly logger = new Logger(CapabilitiesController.name);

  constructor(
    private readonly capabilityService: AiCapabilityService,
    private readonly patternDetector: PatternDetectorService,
  ) {}

  /**
   * Get dashboard data with capability metrics and top limitations
   * Story 7.7 AC#1 (C5 fix: Added RBAC for TL/ADMIN only)
   */
  @Get('dashboard')
  @Throttle({ default: { limit: 20, ttl: 60000 } }) //  20 requests per minute
  @ApiOperation({ summary: 'Get AI capability dashboard data (TL/ADMIN)' })
  @ApiResponse({
    status: 200,
    description: 'Dashboard data retrieved',
    type: CapabilityDashboardResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized - JWT required' })
  @ApiResponse({ status: 403, description: 'Forbidden - TL/ADMIN role required' })
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
   * Story 7.7 AC#1, AC#3 (C5 fix: Added RBAC for TL/ADMIN only)
   */
  @Post('limitations')
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // 10 requests per minute
  @ApiOperation({ summary: 'Document a new AI limitation (TL/ADMIN)' })
  @ApiResponse({ status: 201, description: 'Limitation created' })
  @ApiResponse({ status: 401, description: 'Unauthorized - JWT required' })
  @ApiResponse({ status: 403, description: 'Forbidden - TL/ADMIN role required' })
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
   * Story 7.7 AC#1, AC#3 (C5 fix: Added RBAC for TL/ADMIN only)
   */
  @Put('limitations/:taskType')
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // 10 requests per minute
  @ApiOperation({ summary: 'Update AI limitation and workarounds (TL/ADMIN)' })
  @ApiResponse({ status: 200, description: 'Limitation updated' })
  @ApiResponse({ status: 401, description: 'Unauthorized - JWT required' })
  @ApiResponse({ status: 403, description: 'Forbidden - TL/ADMIN role required' })
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
   * Story 7.7 AC#3 (C5 fix: Added RBAC for TL/PM/QA/ADMIN access)
   */
  @Get('knowledge-base.md')
  @Throttle({ default: { limit: 20, ttl: 60000 } }) // 20 requests per minute
  @ApiOperation({ summary: 'Get AI limitations as Markdown documentation (All roles)' })
  @ApiResponse({ status: 200, description: 'Knowledge base retrieved', type: String })
  @ApiResponse({ status: 401, description: 'Unauthorized - JWT required' })
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
   * Manually trigger pattern analysis (for testing/debugging  - ADMIN only)
   * C5 fix: Added RBAC and aggressive rate limiting
   */
  @Post('analyze-patterns')
  @Throttle({ default: { limit: 3, ttl: 3600000 } }) // 3 requests per hour (expensive operation)
  @ApiOperation({ summary: 'Manually trigger pattern detection analysis (ADMIN only)' })
  @ApiResponse({ status: 200, description: 'Analysis triggered' })
  @ApiResponse({ status: 401, description: 'Unauthorized - JWT required' })
  @ApiResponse({ status: 403, description: 'Forbidden - ADMIN role required' })
  @ApiResponse({ status: 429, description: 'Too many requests - rate limit exceeded' })
  async triggerPatternAnalysis(): Promise<{ success: boolean; patternsDetected: number }> {
    this.logger.log('Manually triggering pattern analysis');

    const patterns = await this.patternDetector.triggerAnalysis();

    return {
      success: true,
      patternsDetected: patterns.length,
    };
  }
}
