import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { InvitationStatus } from '../../../prisma/enums';

export class ListInvitationsQueryDto {
  @ApiPropertyOptional({
    description: 'Page number for pagination (starts at 1)',
    default: 1,
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Number of items per page',
    default: 50,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;

  @ApiPropertyOptional({
    description: 'Filter invitations by status',
    enum: InvitationStatus,
  })
  @IsOptional()
  @IsEnum(InvitationStatus)
  status?: InvitationStatus;
}
