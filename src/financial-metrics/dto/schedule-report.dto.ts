import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsIn, IsString } from 'class-validator';

export class ScheduleReportQueryDto {
    @ApiProperty({
        description: 'Project ID',
        example: 'project-123',
        required: true,
    })
    @IsString()
    projectId!: string;

    @ApiProperty({
        description: 'Recipient email address',
        example: 'stakeholder@example.com',
        required: true,
    })
    @IsEmail()
    email!: string;

    @ApiProperty({
        description: 'Report frequency',
        enum: ['weekly', 'monthly'],
        example: 'weekly',
        required: true,
    })
    @IsIn(['weekly', 'monthly'])
    frequency!: 'weekly' | 'monthly';
}

export class ScheduleReportResponseDto {
    @ApiProperty({
        description: 'Success status',
        example: true,
    })
    success!: boolean;

    @ApiProperty({
        description: 'Response message',
        example: 'Report successfully scheduled',
    })
    message!: string;
}
