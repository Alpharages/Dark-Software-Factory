import { ApiProperty } from '@nestjs/swagger';

export class ServiceStatusDto {
    @ApiProperty({ example: 'up', enum: ['up', 'down'] })
    database!: 'up' | 'down';

    @ApiProperty({ example: 'up', enum: ['up', 'down'] })
    rabbitmq!: 'up' | 'down';
}

export class HealthResponseDto {
    @ApiProperty({ example: 'healthy', enum: ['healthy', 'unhealthy'] })
    status!: 'healthy' | 'unhealthy';

    @ApiProperty({ example: '2025-12-01T10:30:00.000Z' })
    timestamp!: string;

    @ApiProperty({ type: ServiceStatusDto })
    services!: ServiceStatusDto;
}
