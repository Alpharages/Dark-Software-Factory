import { ApiProperty } from '@nestjs/swagger';

/**
 * Hello World Response DTO
 *
 * Response structure for the /api/hello endpoint
 */
export class HelloResponseDto {
  @ApiProperty({
    example: 'Hello World',
    description: 'Greeting message',
  })
  message!: string;

  @ApiProperty({
    example: '2025-12-01T10:30:00.000Z',
    description: 'Current timestamp in ISO 8601 format',
  })
  timestamp!: string;
}
