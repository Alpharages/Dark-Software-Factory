import { PartialType } from '@nestjs/swagger';
import { CreateQualityGateConfigDto } from './create-quality-gate-config.dto';

export class UpdateQualityGateConfigDto extends PartialType(CreateQualityGateConfigDto) {}
