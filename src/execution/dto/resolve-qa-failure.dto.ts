import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum QaFailureResolutionAction {
  OPEN_PR = 'open_pr',
  CANCEL = 'cancel',
}

export class ResolveQaFailureDto {
  @ApiProperty({
    enum: QaFailureResolutionAction,
    description:
      'open_pr: create PR with qa-failed label, move to code review. cancel: mark FAILED, move to manual review.',
    example: 'open_pr',
  })
  @IsEnum(QaFailureResolutionAction)
  action!: QaFailureResolutionAction;
}
