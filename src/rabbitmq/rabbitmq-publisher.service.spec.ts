import { Test, TestingModule } from '@nestjs/testing';
import { RabbitMQPublisherService } from './rabbitmq-publisher.service';
import { RabbitMQService } from './rabbitmq.service';

describe('RabbitMQPublisherService', () => {
  let service: RabbitMQPublisherService;
  let rabbitMQService: RabbitMQService;

  beforeEach(async () => {
    const mockChannel = {
      sendToQueue: jest.fn().mockReturnValue(true),
      publish: jest.fn().mockReturnValue(true),
    };

    const mockRabbitMQService = {
      getChannel: jest.fn().mockReturnValue(mockChannel),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RabbitMQPublisherService,
        {
          provide: RabbitMQService,
          useValue: mockRabbitMQService,
        },
      ],
    }).compile();

    service = module.get<RabbitMQPublisherService>(RabbitMQPublisherService);
    rabbitMQService = module.get<RabbitMQService>(RabbitMQService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should publish message to queue', async () => {
    const result = await service.publishToQueue('test-queue', { data: 'test' });
    expect(result).toBe(true);
  });

  it('should retry publishing on failure', async () => {
    const channel = rabbitMQService.getChannel();
    (channel.sendToQueue as jest.Mock).mockReturnValueOnce(false).mockReturnValueOnce(true);

    const result = await service.publishWithRetry('test-queue', { data: 'test' }, 3);
    expect(result).toBe(true);
    expect(channel.sendToQueue).toHaveBeenCalledTimes(2);
  });
});
