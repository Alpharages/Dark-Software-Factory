import { IsIn, IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateSkillModelMapEntryDto {
  @ApiProperty({ example: 'gpt-5.4', description: 'Model id/alias for this skill' })
  @IsString()
  @IsNotEmpty()
  model!: string;

  @ApiProperty({ enum: ['openai', 'claude'] })
  @IsIn(['openai', 'claude'])
  provider!: string;

  @ApiProperty({ enum: ['oh', 'claude'] })
  @IsIn(['oh', 'claude'])
  runtime!: string;
}
