import { ApiProperty } from '@nestjs/swagger';

export class IntegrationHealthResponseDto {
  @ApiProperty({ example: true, description: 'Presence of SendGrid API key' })
  sendgrid!: boolean;

  @ApiProperty({ example: true, description: 'Presence of OpenAI API key' })
  openai!: boolean;

  @ApiProperty({ example: true, description: 'Presence of Slack Bot token' })
  slack!: boolean;
}
