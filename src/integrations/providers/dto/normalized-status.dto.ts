export enum NormalizedStatusType {
  TODO = 'todo',
  IN_PROGRESS = 'in_progress',
  DONE = 'done',
  CANCELLED = 'cancelled',
  OTHER = 'other',
}

export class NormalizedStatus {
  id!: string;
  name!: string;
  color!: string | null;
  type!: NormalizedStatusType;
}
