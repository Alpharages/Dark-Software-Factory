import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RabbitMQService } from './rabbitmq.service';
import { RabbitMQPublisherService } from './rabbitmq-publisher.service';

@Global() // Makes RabbitMQ services available everywhere
@Module({
  imports: [ConfigModule],
  providers: [RabbitMQService, RabbitMQPublisherService],
  exports: [RabbitMQService, RabbitMQPublisherService],
})
export class RabbitMQModule {}
