import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RabbitMQModule } from '../src/rabbitmq/rabbitmq.module';
import { RabbitMQService } from '../src/rabbitmq/rabbitmq.service';
import { RabbitMQPublisherService } from '../src/rabbitmq/rabbitmq-publisher.service';
import { QUEUE_NAMES } from '../src/rabbitmq/rabbitmq.config';
import configuration from '../src/config/configuration';

describe('RabbitMQ Integration (e2e)', () => {
  let app: INestApplication;
  let rabbitMQService: RabbitMQService;
  let publisherService: RabbitMQPublisherService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          load: [configuration],
        }),
        RabbitMQModule,
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    rabbitMQService = app.get<RabbitMQService>(RabbitMQService);
    publisherService = app.get<RabbitMQPublisherService>(RabbitMQPublisherService);

    // Wait for RabbitMQ to be fully initialized
    // We skip this wait if we know docker is not running, but for E2E we assume it is or fail
    // In this specific run, we know docker might be down, so this test might fail or timeout
    // But we write it as per requirements.
    await new Promise((resolve) => setTimeout(resolve, 2000));
  });

  afterAll(async () => {
    await app.close();
  });

  it('should connect to RabbitMQ', async () => {
    const isHealthy = await rabbitMQService.isHealthy();
    expect(isHealthy).toBe(true);
  });

  it('should publish message to queue', async () => {
    const payload = { testData: 'Hello RabbitMQ' };
    const result = await publisherService.publishToQueue(QUEUE_NAMES.AI_EXECUTION, payload);

    expect(result).toBe(true);
  });

  it('should get queue statistics', async () => {
    const stats = await rabbitMQService.getQueueStats(QUEUE_NAMES.AI_EXECUTION);

    expect(stats).toBeDefined();
    expect(stats.messageCount).toBeGreaterThanOrEqual(0);
    expect(stats.consumerCount).toBeGreaterThanOrEqual(0);
  });
});
