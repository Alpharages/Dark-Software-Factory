import { ApiProperty } from '@nestjs/swagger';

/**
 * Response DTO for the Hello World endpoint
 */
export class HelloResponseDto {
  @ApiProperty({
    example: 'Hello World',
    description: 'Greeting message',
  })
  message!: string;

  @ApiProperty({
    example: '2025-12-01T10:30:00.000Z',
    description: 'Current timestamp in ISO format',
  })
  timestamp!: string;
}
