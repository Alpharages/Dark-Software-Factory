import { ApiProperty } from '@nestjs/swagger';

export class SkillComputeStatDto {
  @ApiProperty({ example: 'clickup-dev-implement' })
  skill!: string;

  @ApiProperty({ example: '12.50' })
  totalCostUsd!: string;

  @ApiProperty({ example: 4 })
  runCount!: number;

  @ApiProperty({ example: 12500, nullable: true })
  avgDurationMs!: number | null;
}

export class SkillProjectComputeStatDto extends SkillComputeStatDto {
  @ApiProperty({ example: 'project-1', nullable: true })
  projectId!: string | null;
}

export class SkillComputeStatsDto {
  @ApiProperty({ type: [SkillComputeStatDto] })
  bySkill!: SkillComputeStatDto[];

  @ApiProperty({ type: [SkillProjectComputeStatDto] })
  bySkillProject!: SkillProjectComputeStatDto[];
}
