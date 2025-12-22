import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsInt, Min, Max, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';
import { AuditLogDto } from './audit-timeline.dto';
import { PaginationMetaDto } from './pagination.dto';

export class LowConfidenceQueryDto {
  @ApiProperty({
    example: 1,
    description: 'Page number (1-indexed)',
    required: false,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiProperty({
    example: 50,
    description: 'Items per page',
    required: false,
    default: 50,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;

  @ApiProperty({
    example: 0.5,
    description: 'Confidence threshold (default 0.5)',
    required: false,
    default: 0.5,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  minConfidence?: number = 0.5;
}

export class LowConfidenceResponseDto {
  @ApiProperty({ type: 'array', description: 'Low-confidence decisions' })
  data!: AuditLogDto[];

  @ApiProperty({ type: () => PaginationMetaDto, description: 'Pagination metadata' })
  meta!: PaginationMetaDto;
}
