import { ApiProperty } from '@nestjs/swagger';
import { UserDto } from '../../dto/user.dto';
import { PaginationMetaDto } from './pagination-meta.dto';

export class PaginatedUsersResponseDto {
  @ApiProperty({
    description: 'Array of user objects',
    type: [UserDto],
  })
  users!: UserDto[];

  @ApiProperty({
    description: 'Pagination metadata',
    type: PaginationMetaDto,
  })
  pagination!: PaginationMetaDto;
}
