import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TestExecutionDto {
  @ApiProperty({
    description: 'ClickUp task id to pass to the OpenHarness skill run',
    example: '86ey08c75',
  })
  @IsString()
  @IsNotEmpty()
  ticketId!: string;

  @ApiPropertyOptional({
    description: 'OpenHarness skill or prompt to run; defaults to openharness.defaultSkill',
    example: 'clickup-dev-implement',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  skill?: string;

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
