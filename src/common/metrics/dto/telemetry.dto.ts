import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ShortcutTelemetryDto {
  @ApiProperty({ description: 'The identifier of the shortcut used' })
  @IsString()
  @IsNotEmpty()
  shortcut!: string;
}
