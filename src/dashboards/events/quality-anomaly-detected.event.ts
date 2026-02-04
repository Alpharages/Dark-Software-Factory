export class QualityAnomalyDetectedEvent {
  constructor(
    public readonly anomalyId: string,
    public readonly projectId: string,
    public readonly metric: string,
    public readonly severity: string,
    public readonly type: string,
    public readonly currentValue: number,
    public readonly previousValue?: number,
  ) {}
}
