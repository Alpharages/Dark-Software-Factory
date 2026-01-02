import { PartialType } from '@nestjs/swagger';
import { CreateConstraintDto } from './create-constraint.dto';

export class UpdateConstraintDto extends PartialType(CreateConstraintDto) {}
