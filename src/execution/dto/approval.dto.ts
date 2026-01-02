import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString, IsOptional } from 'class-validator';
import { ApprovalDecision } from '@/prisma/client';

export class ApprovalActionDto {
  @ApiProperty({ description: 'The decision made by the PM', enum: ApprovalDecision })
  @IsEnum(ApprovalDecision)
  decision!: ApprovalDecision;

  @ApiProperty({ description: 'Optional reasoning or feedback for the decision', required: false })
  @IsString()
  @IsOptional()
  reasoning?: string;
}

export class ApprovalResponseDto {
  @ApiProperty({ description: 'Whether the action was successful' })
  success!: boolean;

  @ApiProperty({ description: 'The new status of the ticket or execution', required: false })
  status?: string;

  @ApiProperty({ description: 'Whether the execution was escalated', required: false })
  escalated?: boolean;
}
