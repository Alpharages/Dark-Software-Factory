import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { Prisma } from '@/prisma/client';
import { CreateConstraintDto } from './dto/create-constraint.dto';
import { UpdateConstraintDto } from './dto/update-constraint.dto';

@Injectable()
export class ArchitectureConstraintsService {
  private readonly logger = new Logger(ArchitectureConstraintsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(createDto: CreateConstraintDto) {
    this.logger.log(`Creating constraint: ${createDto.type} (${createDto.scope})`);
    return this.prisma.architectureConstraint.create({
      data: {
        ...createDto,
        rules: createDto.rules as Prisma.InputJsonValue,
      },
    });
  }

  async findAll(projectId?: string) {
    this.logger.log(`Finding constraints for project: ${projectId || 'GLOBAL'}`);

    // Get globals
    const globals = await this.prisma.architectureConstraint.findMany({
      where: { scope: 'GLOBAL' },
    });

    if (!projectId) {
      return globals;
    }

    // Get project specifics
    const projectSpecific = await this.prisma.architectureConstraint.findMany({
      where: { projectId },
    });

    // Merge logic: Currently additive.
    // Project constraints are returned alongside global constraints.
    // The Policy Validator applies all of them.
    // Future enhancement: Allow project constraints to explicitly disable/override specific global rules.
    return [...globals, ...projectSpecific];
  }

  async findOne(id: string) {
    return this.prisma.architectureConstraint.findUniqueOrThrow({
      where: { id },
    });
  }

  async update(id: string, updateDto: UpdateConstraintDto) {
    return this.prisma.architectureConstraint.update({
      where: { id },
      data: {
        ...updateDto,
        rules: updateDto.rules ? (updateDto.rules as Prisma.InputJsonValue) : undefined,
        version: { increment: 1 },
      },
    });
  }

  async remove(id: string) {
    return this.prisma.architectureConstraint.delete({
      where: { id },
    });
  }
}
