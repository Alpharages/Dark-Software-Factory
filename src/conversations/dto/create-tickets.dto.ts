import { IsArray, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateTicketsDto {
    @ApiProperty({
        type: [String],
        description: 'Array of action item IDs to create tickets for'
    })
    @IsArray()
    @IsUUID('4', { each: true })
    action_item_ids!: string[];
}
