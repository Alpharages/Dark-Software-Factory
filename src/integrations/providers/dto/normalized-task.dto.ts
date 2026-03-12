import { NormalizedStatus } from './normalized-status.dto';

export class NormalizedTask {
  id!: string;
  name!: string;
  description!: string | null;
  status!: NormalizedStatus;
  url!: string;
  assignees?: { id: string; name: string; email?: string }[];
  tags?: string[];
  /** Keyed by field ID; matches IRawTaskEvent.customFields shape for direct event mapping. */
  customFields?: Record<string, unknown>;
  priority?: string | null;
  /** ISO 8601 string or epoch ms string as returned by the provider API. */
  dateCreated?: string | null;
  dateUpdated?: string | null;
  dateClosed?: string | null;
}
