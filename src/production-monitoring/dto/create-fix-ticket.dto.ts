import { IsString, IsNumber, IsOptional, IsArray, IsNotEmpty } from 'class-validator';

export class CreateFixTicketDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  description!: string;

  @IsNumber()
  priority!: number;

  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  assignees?: number[];

  @IsArray()
  @IsString({ each: true })
  tags!: string[];
}
