import { ApiProperty } from '@nestjs/swagger';

export class UnauthorizedResponseDto {
  @ApiProperty({ example: 401 })
  statusCode!: number;

  @ApiProperty({ example: 'Unauthorized' })
  message!: string;
}

export class ForbiddenResponseDto {
  @ApiProperty({ example: 403 })
  statusCode!: number;

  @ApiProperty({ example: 'Forbidden resource' })
  message!: string;

  @ApiProperty({ example: 'Forbidden' })
  error!: string;
}
