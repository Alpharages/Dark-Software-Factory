import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AiQaOrchestrator } from './ai-qa-orchestrator.service';
import { QaMetricsService } from './qa-metrics.service';
import { PrismaService } from '../database/prisma.service';
import { SentryService } from '../common/sentry/sentry.service';
import { QaNotificationService } from './services/qa-notification.service';

describe('AiQaOrchestrator', () => {
  it('skips AI-delegated checks after ai-routing removal', async () => {
    const qAResult = {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiQaOrchestrator,
        { provide: QaMetricsService, useValue: { recordCheckComplete: jest.fn() } },
        { provide: PrismaService, useValue: { qAResult } },
        { provide: SentryService, useValue: { captureException: jest.fn() } },
        { provide: QaNotificationService, useValue: {} },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(2) } },
      ],
    }).compile();

    const service = module.get(AiQaOrchestrator);
    const result = await service.executeLintCheck('ticket-1', 'exec-1', '/tmp/project');

    expect(result.status).toBe('SKIPPED');
    expect(result.aiProvider).toBe('openharness');
    expect(qAResult.create).toHaveBeenCalled();
  });
});
