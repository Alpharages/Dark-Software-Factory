import { Test, TestingModule } from '@nestjs/testing';
import { AppMetricsModule } from '../metrics.module';
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
});
