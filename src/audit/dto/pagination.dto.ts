import { ApiProperty } from '@nestjs/swagger';

export class PaginationMetaDto {
  @ApiProperty({ example: 1, description: 'Current page number (1-' })
  page!: number;

  @ApiProperty({ example: 50, description: 'Items per page' })
  limit!: number;

  @ApiProperty({ example: 234, description: 'Total matching records' })
  total!: number;

  @ApiProperty({ example: 5, description: 'Total pages available' })
  totalPages!: number;

  @ApiProperty({ example: true, description: 'More pages available' })
  hasMore!: boolean;
}
