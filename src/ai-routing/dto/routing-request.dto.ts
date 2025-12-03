import { IsString, IsNotEmpty, IsArray, IsNumber, IsIn, Min, Max } from 'class-validator';

export class RoutingRequestDto {
  @IsString()
  @IsNotEmpty()
  correlationId!: string;

  @IsString()
  @IsNotEmpty()
  ticketId!: string;

  @IsString()
  @IsNotEmpty()
  clickupTaskId!: string;

  @IsString()
  @IsNotEmpty()
  projectId!: string;

  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsString()
  description!: string;

  @IsString()
  acceptanceCriteria!: string;

  @IsArray()
  @IsString({ each: true })
  tags!: string[];

  @IsNumber()
  @Min(0)
  @Max(100)
  qualityScore!: number;

  @IsIn(['excellent', 'good', 'fair', 'poor'])
  qualityGrade!: 'excellent' | 'good' | 'fair' | 'poor';

  @IsString()
  timestamp!: string;
}
