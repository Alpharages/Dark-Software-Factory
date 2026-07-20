import { PartialType } from '@nestjs/swagger';
import { CreateProjectDto } from './create-project.dto';
import { DependencyBlockBehavior } from '@/prisma/client';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsInt, IsOptional, Min } from 'class-validator';

export class UpdateProjectDto extends PartialType(CreateProjectDto) {
  @IsOptional()
  @IsBoolean()
  monitor_tasks?: boolean;

  @IsOptional()
  @IsEnum(DependencyBlockBehavior)
  dependency_block_behavior?: DependencyBlockBehavior;

  @ApiPropertyOptional({
    description:
      'Max concurrent AI executions for this project. Null inherits the global `execution.concurrency_limit`.',
    minimum: 1,
    nullable: true,
  })
  @IsOptional() // also permits an explicit null, which resets to "inherit global"
  @IsInt()
  @Min(1)
  execution_concurrency_limit?: number | null;
}
