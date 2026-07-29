import { IsBoolean, IsIn, IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PROVIDERS, RUNTIMES, type Provider, type Runtime } from '../constants';

export class CreateAiAccountDto {
  @ApiProperty({ example: 'claude-1' })
  @IsString()
  @IsNotEmpty()
  label!: string;

  @ApiProperty({ enum: PROVIDERS })
  @IsIn(PROVIDERS)
  provider!: Provider;

  @ApiProperty({ enum: RUNTIMES })
  @IsIn(RUNTIMES)
  runtime!: Runtime;

  @ApiProperty({
    description:
      'Provider-shaped credential object (e.g. { email } for claude, { token } for openai). Encrypted at rest; never returned by any GET.',
    example: { email: 'ops@example.com' },
  })
  @IsObject()
  credentials!: Record<string, string>;

  @ApiProperty({ required: false, example: { weekly_budget: 1000, five_hour_budget: 200 } })
  @IsOptional()
  @IsObject()
  quota_config?: Record<string, unknown>;

  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
