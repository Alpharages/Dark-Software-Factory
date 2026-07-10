import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OpenHarnessSkill } from '@/openharness/skills.enum';

export class TestExecutionDto {
  @ApiProperty({
    description: 'ClickUp task id to pass to the OpenHarness skill run',
    example: '86ey08c75',
  })
  @IsString()
  @IsNotEmpty()
  ticketId!: string;

  @ApiPropertyOptional({
    description: 'OpenHarness skill to run; defaults to openharness.defaultSkill',
    enum: OpenHarnessSkill,
    example: OpenHarnessSkill.CLICKUP_DEV_IMPLEMENT,
  })
  @IsOptional()
  @IsEnum(OpenHarnessSkill)
  skill?: OpenHarnessSkill;

  @ApiPropertyOptional({
    description:
      'Workspace directory used as the child process cwd; defaults to openharness.workspaceDir',
    example: '/Volumes/Data/project/products/alpharages/dsf-backend',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  workspaceDir?: string;

  @ApiPropertyOptional({
    description: 'Maximum OpenHarness turns; defaults to openharness.maxTurns',
    example: 200,
    minimum: 1,
    maximum: 1000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  maxTurns?: number;

  @ApiPropertyOptional({
    description: 'MCP config path for OpenHarness; defaults to openharness.mcpConfigPath',
    example: 'docs/openharness/mcp-config.json',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  mcpConfigPath?: string;
}
