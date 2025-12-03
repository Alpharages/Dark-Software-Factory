import { AIProvider } from '@prisma/client';
import { RoutingReason, IComplexityBreakdown } from '../interfaces';

export class ComplexityBreakdownDto implements IComplexityBreakdown {
  fileCount!: number;
  fileCountScore!: number;
  architectureChanges!: boolean;
  architectureScore!: number;
  dependencyLevel!: 'low' | 'medium' | 'high';
  dependencyScore!: number;
  estimatedLoc!: number;
  locScore!: number;
  tagComplexity!: 'simple' | 'medium' | 'complex';
  tagScore!: number;
  totalScore!: number;
}

export class RoutingDecisionDto {
  correlationId!: string;
  ticketId!: string;
  selectedProvider!: AIProvider;
  complexityScore!: number;
  complexityBreakdown!: ComplexityBreakdownDto;
  routingReason!: RoutingReason;
  fallbackUsed!: boolean;
  originalProvider?: AIProvider;
  decisionTimestamp!: Date;
}

export class RoutingResultDto {
  correlationId!: string;
  ticketId!: string;
  clickupTaskId!: string;
  provider!: AIProvider;
  complexityScore!: number;
  complexityBreakdown!: ComplexityBreakdownDto;
  routingReason!: RoutingReason;
  title!: string;
  description!: string;
  acceptanceCriteria!: string;
  projectId!: string;
  tags!: string[];
  routedAt!: string;
}
