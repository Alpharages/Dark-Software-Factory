/**
 * Git Mirror Module
 * Story 23.1: Local Git Mirror Service
 *
 * NestJS module for local git mirror management.
 * Provides fast workspace cloning by maintaining bare mirrors.
 */

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {
  makeCounterProvider,
  makeGaugeProvider,
  makeHistogramProvider,
} from '@willsoto/nestjs-prometheus';
import { GitMirrorService } from './git-mirror.service';
import { StorageModule } from '../storage/storage.module';
import { LoggerModule } from '../common/logger/logger.module';
import { AppMetricsModule } from '../common/metrics/metrics.module';
import { GitHubModule } from '../github/github.module';

// Prometheus metric providers for git mirror operations
const metricProviders = [
  makeGaugeProvider({
    name: 'git_mirror_total',
    help: 'Total number of local git mirrors',
  }),
  makeCounterProvider({
    name: 'git_mirror_hit_total',
    help: 'Total mirror hits/misses',
    labelNames: ['result'],
  }),
  makeHistogramProvider({
    name: 'git_mirror_clone_duration_seconds',
    help: 'Duration of mirror-based clone operations',
    labelNames: ['source', 'status'],
    buckets: [0.1, 0.5, 1, 2, 5, 10, 30], // Up to 30 seconds
  }),
  makeHistogramProvider({
    name: 'git_mirror_update_duration_seconds',
    help: 'Duration of mirror update operations',
    labelNames: ['status'],
    buckets: [1, 5, 10, 30, 60, 120, 300], // Up to 5 minutes
  }),
  makeGaugeProvider({
    name: 'git_mirror_size_bytes',
    help: 'Size of git mirrors in bytes',
    labelNames: ['owner', 'repo'],
  }),
  makeCounterProvider({
    name: 'git_mirror_evicted_total',
    help: 'Total mirrors evicted due to disk space',
    labelNames: ['reason'],
  }),
];

@Module({
  imports: [ConfigModule, LoggerModule, AppMetricsModule, StorageModule, GitHubModule],
  providers: [GitMirrorService, ...metricProviders],
  exports: [GitMirrorService],
})
export class GitMirrorModule {}
