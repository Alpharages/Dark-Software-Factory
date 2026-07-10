import { Test, TestingModule } from '@nestjs/testing';
import { register } from 'prom-client';
import { AppMetricsModule } from '../metrics.module';
import { AI_METRICS } from '../metrics.constants';
import { MetricsService } from '../metrics.service';
import { BusinessCollector } from './business.collector';

describe('BusinessCollector', () => {
  let collector: BusinessCollector;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [AppMetricsModule],
    })
      .overrideProvider(MetricsService)
      .useValue({})
      .compile();

    collector = module.get(BusinessCollector);
  });

  it('records AI cost when a skill label is present', () => {
    expect(() =>
      collector.recordAICost({
        provider: 'openai',
        model: 'gpt-5',
        inputTokens: 10,
        outputTokens: 5,
        costUsd: 0.01,
        agentName: 'dev',
        operationType: 'execute',
        projectId: 'project-1',
        skill: 'clickup-dev-implement',
      }),
    ).not.toThrow();
  });

  it('buckets unknown skills to keep Prometheus label cardinality bounded', async () => {
    const unknownSkill = `custom-${Date.now()}`;

    collector.recordAICost({
      provider: 'openai',
      model: 'gpt-5',
      inputTokens: 10,
      outputTokens: 5,
      costUsd: 0.01,
      agentName: 'dev',
      operationType: 'execute',
      skill: unknownSkill,
    });

    const metric = await register.getSingleMetric(AI_METRICS.TOKENS_INPUT_TOTAL)?.get();
    expect(metric?.values.some(({ labels }) => labels.skill === unknownSkill)).toBe(false);
    expect(metric?.values.some(({ labels }) => labels.skill === 'custom')).toBe(true);
  });
});
