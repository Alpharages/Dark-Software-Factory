import { IsArray, IsEnum, IsNotEmpty, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { OpenHarnessSkill } from '@/openharness/skills.enum';

export class StatusSkillEntryDto {
  @ApiProperty({ example: 'approved', description: 'ClickUp status that triggers the skill' })
  @IsString()
  @IsNotEmpty()
  status!: string;

  @ApiProperty({ enum: OpenHarnessSkill, example: OpenHarnessSkill.CLICKUP_QA })
  @IsEnum(OpenHarnessSkill)
  skill!: OpenHarnessSkill;
}

export class UpdateGlobalStatusSkillMapDto {
  @ApiProperty({ type: [StatusSkillEntryDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StatusSkillEntryDto)
  entries!: StatusSkillEntryDto[];
}
