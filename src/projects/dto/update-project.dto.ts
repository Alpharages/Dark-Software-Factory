import { PartialType } from '@nestjs/swagger';
import { CreateProjectDto } from './create-project.dto';
import { DependencyBlockBehavior } from '@/prisma/client';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';

export class UpdateProjectDto extends PartialType(CreateProjectDto) {
  @IsOptional()
  @IsBoolean()
  monitor_tasks?: boolean;

  @IsOptional()
  @IsEnum(DependencyBlockBehavior)
  dependency_block_behavior?: DependencyBlockBehavior;
}
