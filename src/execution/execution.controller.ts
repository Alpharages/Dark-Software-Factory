import { Controller, Get, Param, UseGuards, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { ExecutionService } from './execution.service';
import { ExecutionResponseDto } from './dto/execution.dto';
import { JwtAuthGuard } from '@/common/guards/auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { Role } from '@/auth/constants/roles.enum';

@ApiTags('Execution')
@Controller('api/v1/executions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ExecutionController {
    constructor(private readonly executionService: ExecutionService) { }

    @Get(':id/status')
    @Roles(Role.PM, Role.ADMIN, Role.TL)
    @ApiOperation({ summary: 'Get current execution status for polling fallback' })
    @ApiParam({ name: 'id', description: 'Execution UUID' })
    @ApiResponse({ status: 200, type: ExecutionResponseDto })
    @ApiResponse({ status: 404, description: 'Execution not found' })
    async getStatus(@Param('id') id: string): Promise<ExecutionResponseDto> {
        const execution = await this.executionService.getExecution(id);
        if (!execution) {
            throw new NotFoundException(`Execution with ID ${id} not found`);
        }
        return execution;
    }
}
