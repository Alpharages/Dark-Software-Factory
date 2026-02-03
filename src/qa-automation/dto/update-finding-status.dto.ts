import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString, IsOptional } from 'class-validator';

export enum FindingStatus {
  PENDING = 'PENDING',
  ACKNOWLEDGED = 'ACKNOWLEDGED',
  FIXED = 'FIXED',
  DISPUTED = 'DISPUTED',
}

export class UpdateFindingStatusDto {
  @ApiProperty({ enum: FindingStatus })
  @IsEnum(FindingStatus)
  status!: FindingStatus;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  review_notes?: string;
}
