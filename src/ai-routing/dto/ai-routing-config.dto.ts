import { IsInt, IsOptional, IsEnum, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AIProvider } from '@prisma/client';

export class UpdateAiRoutingConfigDto {
  @IsEnum(AIProvider)
  @IsOptional()
  @ApiPropertyOptional({
    enum: AIProvider,
    nullable: true,
    description: 'Force all routing to a specific provider. Set to null to clear.',
  })
  primaryProviderOverride?: AIProvider | null;

  @IsInt()
  @Min(0)
  @Max(99)
  @IsOptional()
  @ApiPropertyOptional({
    example: 10,
    description: 'Score threshold above which routing enters Medium tier',
  })
  complexityThresholdMedium?: number;

  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  @ApiPropertyOptional({
    example: 40,
    description: 'Score threshold above which routing enters High tier',
  })
  complexityThresholdHigh?: number;

  @IsEnum(AIProvider)
  @IsOptional()
  @ApiPropertyOptional({ enum: AIProvider })
  tierLowPrimary?: AIProvider;

  @IsEnum(AIProvider)
  @IsOptional()
  @ApiPropertyOptional({ enum: AIProvider, nullable: true })
  tierLowFallback?: AIProvider | null;

  @IsEnum(AIProvider)
  @IsOptional()
  @ApiPropertyOptional({ enum: AIProvider })
  tierMediumPrimary?: AIProvider;

  @IsEnum(AIProvider)
  @IsOptional()
  @ApiPropertyOptional({ enum: AIProvider, nullable: true })
  tierMediumFallback?: AIProvider | null;

  @IsEnum(AIProvider)
  @IsOptional()
  @ApiPropertyOptional({ enum: AIProvider })
  tierHighPrimary?: AIProvider;

  @IsEnum(AIProvider)
  @IsOptional()
  @ApiPropertyOptional({ enum: AIProvider, nullable: true })
  tierHighFallback?: AIProvider | null;
}

export class EffectiveAiRoutingConfigDto {
  @ApiProperty({ enum: AIProvider, nullable: true })
  primaryProviderOverride!: AIProvider | null;

  @ApiProperty()
  complexityThresholdMedium!: number;

  @ApiProperty()
  complexityThresholdHigh!: number;

  @ApiProperty({ enum: AIProvider })
  tierLowPrimary!: AIProvider;

  @ApiProperty({ enum: AIProvider, nullable: true })
  tierLowFallback!: AIProvider | null;

  @ApiProperty({ enum: AIProvider })
  tierMediumPrimary!: AIProvider;

  @ApiProperty({ enum: AIProvider, nullable: true })
  tierMediumFallback!: AIProvider | null;

  @ApiProperty({ enum: AIProvider })
  tierHighPrimary!: AIProvider;

  @ApiProperty({ enum: AIProvider, nullable: true })
  tierHighFallback!: AIProvider | null;
}
