import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsISO8601, IsInt, Min, Max, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';
import { AuditLogDto } from './audit-timeline.dto';
import { PaginationMetaDto } from './pagination.dto';

export class AuditSearchQueryDto {
  @ApiProperty({
    example: 'QaOrchestrator',
    description: 'Filter by agent name',
    required: false,
  })
  @IsOptional()
  @IsString()
  agent_name?: string;

  @ApiProperty({
    example: 'ai_provider_selection',
    description: 'Filter by action type',
    required: false,
  })
  @IsOptional()
  @IsString()
  action?: string;

  @ApiProperty({
    example: 'DSF-123',
    description: 'Filter by ticket ID',
    required: false,
  })
  @IsOptional()
  @IsString()
  ticketId?: string;

  @ApiProperty({
    example: 'exec-uuid',
    description: 'Filter by execution ID',
    required: false,
  })
  @IsOptional()
  @IsUUID()
  executionId?: string;

  @ApiProperty({
    example: '2025-12-20T00:00:00.000Z',
    description: 'Start date (ISO 8601 format)',
    required: false,
  })
  @IsOptional()
  @IsISO8601()
  startDate?: string;

  @ApiProperty({
    example: '2025-12-22T23:59:59.999Z',
    description: 'End date (ISO 8601 format)',
    required: false,
  })
  @IsOptional()
  @IsISO8601()
  endDate?: string;

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
}

export class AuditSearchResponseDto {
  @ApiProperty({ type: 'array', description: 'Matching audit logs' })
  data!: AuditLogDto[];

  @ApiProperty({ type: () => PaginationMetaDto, description: 'Pagination metadata' })
  meta!: PaginationMetaDto;
}
