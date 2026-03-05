import { IsBoolean, IsIn, IsOptional, ValidateIf } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateProjectStatusDto {
  @ApiPropertyOptional({
    description: 'Active status of the project (boolean form). Use this OR `status`, not both.',
    example: true,
  })
  @ValidateIf((o: UpdateProjectStatusDto) => o.status === undefined)
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Status of the project as a string — alternative to `isActive`.',
    enum: ['active', 'inactive'],
    example: 'active',
  })
  @ValidateIf((o: UpdateProjectStatusDto) => o.isActive === undefined)
  @IsIn(['active', 'inactive'])
  @IsOptional()
  status?: string;
}
