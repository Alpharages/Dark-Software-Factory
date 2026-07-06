import { DependencyEdgeType } from '@/prisma/client';

export interface DependencyEdge {
  dependsOnExternalId: string;
  type: DependencyEdgeType;
}

export interface IDependencyProvider {
  readonly source: 'clickup' | 'jira' | 'asana';
  getDependencies(externalId: string, task?: unknown): Promise<DependencyEdge[]>;
}

export const DEPENDENCY_PROVIDER = Symbol('DEPENDENCY_PROVIDER');
