/**
 * Cost Tracking DTOs
 * Story 2.7: AI Provider Integration - Claude Code (Anthropic)
 *
 * DTOs for tracking AI provider costs and token usage.
 */

import { IsNumber, IsString, IsEnum, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { AIProvider } from '@/prisma/client';

/**
 * Token usage for a single execution
 */
export class TokenUsageDto {
  @ApiProperty({ description: 'Number of input tokens used' })
  @IsNumber()
  @Min(0)
  inputTokens!: number;

  @ApiProperty({ description: 'Number of output tokens used' })
  @IsNumber()
  @Min(0)
  outputTokens!: number;

  @ApiProperty({ description: 'Total tokens used' })
  @IsNumber()
  @Min(0)
  totalTokens!: number;
}

/**
 * Cost breakdown for a single execution
 */
export class ExecutionCostDto {
  @ApiProperty({ description: 'Execution ID' })
  @IsString()
  executionId!: string;

  @ApiProperty({ description: 'AI provider used', enum: AIProvider })
  @IsEnum(AIProvider)
  provider!: AIProvider;

  @ApiProperty({ description: 'Token usage details' })
  tokenUsage!: TokenUsageDto;

  @ApiProperty({ description: 'Input token cost in cents' })
  @IsNumber()
  @Min(0)
  inputCostCents!: number;

  @ApiProperty({ description: 'Output token cost in cents' })
  @IsNumber()
  @Min(0)
  outputCostCents!: number;

  @ApiProperty({ description: 'Total cost in cents' })
  @IsNumber()
  @Min(0)
  totalCostCents!: number;

  @ApiProperty({ description: 'Timestamp of execution' })
  timestamp!: Date;
}

/**
 * Provider cost summary
 */
export class ProviderCostSummaryDto {
  @ApiProperty({ description: 'AI provider', enum: AIProvider })
  @IsEnum(AIProvider)
  provider!: AIProvider;

  @ApiProperty({ description: 'Total executions' })
  @IsNumber()
  @Min(0)
  totalExecutions!: number;

  @ApiProperty({ description: 'Total input tokens' })
  @IsNumber()
  @Min(0)
  totalInputTokens!: number;

  @ApiProperty({ description: 'Total output tokens' })
  @IsNumber()
  @Min(0)
  totalOutputTokens!: number;

  @ApiProperty({ description: 'Total cost in cents' })
  @IsNumber()
  @Min(0)
  totalCostCents!: number;

  @ApiProperty({ description: 'Average cost per execution in cents' })
  @IsNumber()
  @Min(0)
  averageCostCents!: number;
}

/**
 * Cost rate configuration per provider
 */
export interface ProviderCostRates {
  /** Cost per 1M input tokens in cents */
  inputTokenRate: number;
  /** Cost per 1M output tokens in cents */
  outputTokenRate: number;
}

/**
 * Default cost rates for providers
 * Reference: Anthropic pricing as of 2024
 */
export const PROVIDER_COST_RATES: Record<string, ProviderCostRates> = {
  CLAUDE_CODE: {
    inputTokenRate: 300, // $3.00 per 1M tokens = 300 cents
    outputTokenRate: 1500, // $15.00 per 1M tokens = 1500 cents
  },
  CURSOR_HEADLESS: {
    inputTokenRate: 0, // Cursor uses subscription model
    outputTokenRate: 0,
  },
};

// Map-based cost rates lookup for type-safe access
const costRatesMap = new Map<string, ProviderCostRates>(Object.entries(PROVIDER_COST_RATES));

/**
 * Calculate cost from token usage
 */
export function calculateCost(
  provider: AIProvider,
  inputTokens: number,
  outputTokens: number,
): { inputCostCents: number; outputCostCents: number; totalCostCents: number } {
  const rates = costRatesMap.get(provider) ?? { inputTokenRate: 0, outputTokenRate: 0 };

  const inputCostCents = (inputTokens / 1_000_000) * rates.inputTokenRate;
  const outputCostCents = (outputTokens / 1_000_000) * rates.outputTokenRate;
  const totalCostCents = inputCostCents + outputCostCents;

  return {
    inputCostCents: Math.round(inputCostCents * 100) / 100,
    outputCostCents: Math.round(outputCostCents * 100) / 100,
    totalCostCents: Math.round(totalCostCents * 100) / 100,
  };
}
