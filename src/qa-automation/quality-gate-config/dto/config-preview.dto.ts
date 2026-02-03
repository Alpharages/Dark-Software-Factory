import { IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { CreateQualityThresholdsDto } from './create-quality-gate-config.dto';

export class ConfigPreviewRequestDto {
  @IsString()
  @ApiProperty({ example: 'project-uuid' })
  projectId!: string;

  @ValidateNested()
  @Type(() => CreateQualityThresholdsDto)
  @ApiProperty({ type: CreateQualityThresholdsDto })
  configuration!: CreateQualityThresholdsDto;
}

export class ConfigPreviewResponseDto {
  @ApiProperty()
  previewResults!: {
    totalTicketsAnalyzed: number;
    wouldPass: number;
    wouldFail: number;
    currentPassRate: number;
    impact: string;
  };

  @ApiProperty()
  failureBreakdown!: Record<string, number>;
}
