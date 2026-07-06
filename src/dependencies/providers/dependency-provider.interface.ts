import { DependencyEdgeType } from '@/prisma/client';

export interface DependencyEdge {
  dependsOnExternalId: string;
  type: DependencyEdgeType;
}

export interface IDependencyProvider {
  readonly source: 'clickup' | 'jira' | 'asana';
  /** Returns null when the payload's dependency data can't be determined (as opposed to
   *  a confirmed-empty list) — callers must not reconcile against a null result, since
   *  doing so would delete every existing edge based on no real signal. */
  getDependencies(externalId: string, task?: unknown): Promise<DependencyEdge[] | null>;
}

export const DEPENDENCY_PROVIDER = Symbol('DEPENDENCY_PROVIDER');
