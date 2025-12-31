import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ArchitectureConstraintsService } from './architecture-constraints.service';
import { CreateConstraintDto } from './dto/create-constraint.dto';
import { UpdateConstraintDto } from './dto/update-constraint.dto';
// Assuming Guards exist, e.g., JwtAuthGuard, RolesGuard
// import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
// import { RolesGuard } from '../../common/guards/roles.guard';
// import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('architecture-constraints')
@Controller('api/v1/architecture-constraints')
export class ArchitectureConstraintsController {
    constructor(private readonly constraintsService: ArchitectureConstraintsService) { }

    @Post()
    @ApiOperation({ summary: 'Create a new architecture constraint' })
    // @UseGuards(JwtAuthGuard, RolesGuard)
    // @Roles('TL', 'ADMIN') // Example roles
    create(@Body() createDto: CreateConstraintDto) {
        return this.constraintsService.create(createDto);
    }

    @Get()
    @ApiOperation({ summary: 'Get all constraints, optionally filtered by project' })
    findAll(@Query('projectId') projectId?: string) {
        return this.constraintsService.findAll(projectId);
    }

    @Get(':id')
    @ApiOperation({ summary: 'Get a constraint by ID' })
    findOne(@Param('id') id: string) {
        return this.constraintsService.findOne(id);
    }

    @Patch(':id')
    @ApiOperation({ summary: 'Update a constraint' })
    update(@Param('id') id: string, @Body() updateDto: UpdateConstraintDto) {
        return this.constraintsService.update(id, updateDto);
    }

    @Delete(':id')
    @ApiOperation({ summary: 'Delete a constraint' })
    remove(@Param('id') id: string) {
        return this.constraintsService.remove(id);
    }
}
