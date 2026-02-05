import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class FilterCriteriaDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  projectId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  severity?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  executionProvider?: string;
}

export class CreateNotificationPreferenceDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  eventType!: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsArray()
  @IsString({ each: true })
  channels!: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => FilterCriteriaDto)
  filterCriteria?: FilterCriteriaDto;
}
