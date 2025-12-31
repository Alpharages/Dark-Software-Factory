import { PartialType } from '@nestjs/swagger';
import { CreateAdrDto } from './create-adr.dto';

export class UpdateAdrDto extends PartialType(CreateAdrDto) { }
