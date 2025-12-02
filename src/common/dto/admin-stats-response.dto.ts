import { ApiProperty } from '@nestjs/swagger';

export class AdminStatsResponseDto {
    @ApiProperty({ example: 'Admin only stats' })
    message!: string;

    @ApiProperty({ example: '2025-12-01T10:30:00.000Z' })
    timestamp!: string;
}
