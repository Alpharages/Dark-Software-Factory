export enum NormalizedFieldType {
  TEXT = 'text',
  NUMBER = 'number',
  DATE = 'date',
  DROPDOWN = 'dropdown',
  LABELS = 'labels',
  USER = 'user',
  CHECKBOX = 'checkbox',
  URL = 'url',
  OTHER = 'other',
}

/** Union of all valid custom field value types across PM providers. */
export type FieldValue = string | number | boolean | string[] | null;

export class NormalizedFieldOption {
  id!: string;
  label!: string;
  color?: string;
  value?: FieldValue;
}

export class NormalizedField {
  id!: string;
  name!: string;
  type!: NormalizedFieldType;
  required!: boolean;
  options?: NormalizedFieldOption[];
  description?: string;
}

export class NormalizedFieldValue {
  fieldId!: string;
  value!: FieldValue;
}
