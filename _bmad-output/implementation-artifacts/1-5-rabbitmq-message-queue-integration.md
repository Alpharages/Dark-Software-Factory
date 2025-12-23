# Story 1.5: RabbitMQ Message Queue Integration

**Epic:** 1 - Foundation & Development Environment  
**Status:** ready-for-dev  
**Priority:** P0 - BLOCKER  
**Effort:** 3 story points  
**ClickUp ID:** `86evnjw8g`  
**ClickUp URL:** https://app.clickup.com/t/86evnjw8g

---

## Story

As a developer,
I want RabbitMQ integrated as the message queue,
So that I can process AI executions, QA checks, and deployments asynchronously.

---

## Acceptance Criteria

**Given** RabbitMQ 3.13 is available (local or Docker)  
**When** I integrate RabbitMQ with NestJS  
**Then** the following is configured:
- `@nestjs/microservices` with RabbitMQ transport installed
- RabbitMQ connection established via RABBITMQ_URL
- Connection health check succeeds

**And** these queues are created (per architecture):
- `ai-execution-queue` (for AI task processing)
- `qa-check-queue` (for quality gate checks)
- `deployment-queue` (for CI/CD triggers)
- `monitoring-queue` (for production events)

**And** dead letter queue is configured for failed messages  
**And** RabbitMQ management UI is accessible at http://localhost:15672  
**And** Message acknowledgment is configured (manual ack for reliability)

---

## Technical Requirements

### Step 1: Install RabbitMQ Dependencies

```bash
# Install NestJS microservices package
npm install @nestjs/microservices

# Install RabbitMQ client library
npm install amqplib

# Install types for TypeScript
npm install -D @types/amqplib
```

**Why these dependencies:**
- `@nestjs/microservices` - NestJS module for microservice patterns (supports RabbitMQ, Kafka, Redis, etc.)
- `amqplib` - Node.js client for AMQP protocol (RabbitMQ)
- `@types/amqplib` - TypeScript type definitions

---

### Step 2: Add RabbitMQ to Docker Compose

**File:** `docker-compose.yml` (update existing file from Story 1.3)

```yaml
version: '3.8'

services:
  # PostgreSQL (from Story 1.3)
  postgres:
    image: postgres:16-alpine
    container_name: ai-orchestrator-postgres
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: ai_orchestrator
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  # RabbitMQ (NEW)
  rabbitmq:
    image: rabbitmq:3.13-management-alpine
    container_name: ai-orchestrator-rabbitmq
    environment:
      RABBITMQ_DEFAULT_USER: guest
      RABBITMQ_DEFAULT_PASS: guest
    ports:
      - "5672:5672"    # AMQP protocol
      - "15672:15672"  # Management UI
    volumes:
      - rabbitmq_data:/var/lib/rabbitmq
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

volumes:
  postgres_data:
    driver: local
  rabbitmq_data:
    driver: local
```

**Start services:**
```bash
docker-compose up -d
```

**Verify RabbitMQ is running:**
```bash
docker-compose ps
# Should show rabbitmq container healthy

docker-compose logs -f rabbitmq
# Should show "Server startup complete"
```

**Access RabbitMQ Management UI:**
- URL: http://localhost:15672
- Username: `guest`
- Password: `guest`

---

### Step 3: Update Environment Configuration

**File:** `.env` (update existing file from Story 1.4)

```bash
# ... existing variables ...

# ===========================================
# MESSAGE QUEUE
# ===========================================
# RabbitMQ Connection String
# Format: amqp://USER:PASSWORD@HOST:PORT/VHOST
RABBITMQ_URL=amqp://guest:guest@localhost:5672
```

**Connection String Format:**
```
amqp://[USER]:[PASSWORD]@[HOST]:[PORT]/[VHOST]

Components:
- USER: guest (default)
- PASSWORD: guest (change in production!)
- HOST: localhost (or docker service name)
- PORT: 5672 (AMQP default)
- VHOST: / (default virtual host, omit or use %2F)
```

**Production example:**
```bash
RABBITMQ_URL=amqp://orchestrator:secure-password@rabbitmq-prod.example.com:5672/orchestrator-vhost
```

---

### Step 4: Create RabbitMQ Configuration

**File:** `src/rabbitmq/rabbitmq.config.ts`

```typescript
import { Transport } from '@nestjs/microservices';

export interface RabbitMQConfig {
  transport: Transport.RMQ;
  options: {
    urls: string[];
    queue: string;
    queueOptions: {
      durable: boolean;
      deadLetterExchange?: string;
      deadLetterRoutingKey?: string;
      messageTtl?: number;
    };
    prefetchCount?: number;
    noAck?: boolean;
  };
}

/**
 * Base RabbitMQ configuration
 * All queues inherit from this config
 */
export const createQueueConfig = (
  queueName: string,
  url: string,
): RabbitMQConfig => ({
  transport: Transport.RMQ,
  options: {
    urls: [url],
    queue: queueName,
    queueOptions: {
      durable: true, // Persist queue across RabbitMQ restarts
      deadLetterExchange: 'dlx-exchange', // Route failed messages
      deadLetterRoutingKey: `dlx-${queueName}`,
      messageTtl: 3600000, // 1 hour (messages expire if not processed)
    },
    prefetchCount: 1, // Process one message at a time per worker
    noAck: false, // Manual acknowledgment required
  },
});

/**
 * Queue names (must match architecture naming convention)
 */
export const QUEUE_NAMES = {
  AI_EXECUTION: 'ai-execution-queue',
  QA_CHECK: 'qa-check-queue',
  DEPLOYMENT: 'deployment-queue',
  MONITORING: 'monitoring-queue',
  DEAD_LETTER: 'dead-letter-queue',
} as const;

/**
 * Exchange names
 */
export const EXCHANGE_NAMES = {
  ORCHESTRATOR_EVENTS: 'orchestrator-events',
  DEAD_LETTER_EXCHANGE: 'dlx-exchange',
} as const;

/**
 * Routing keys (dot notation per architecture)
 */
export const ROUTING_KEYS = {
  // AI Execution
  AI_EXECUTION_STARTED: 'ai.execution.started',
  AI_EXECUTION_COMPLETED: 'ai.execution.completed',
  AI_EXECUTION_FAILED: 'ai.execution.failed',

  // QA Check
  QA_CHECK_STARTED: 'qa.check.started',
  QA_CHECK_COMPLETED: 'qa.check.completed',
  QA_CHECK_FAILED: 'qa.check.failed',

  // Deployment
  DEPLOYMENT_TRIGGERED: 'deployment.triggered',
  DEPLOYMENT_COMPLETED: 'deployment.completed',
  DEPLOYMENT_FAILED: 'deployment.failed',

  // Monitoring
  PRODUCTION_ERROR_DETECTED: 'monitoring.error.detected',
  PRODUCTION_ERROR_RESOLVED: 'monitoring.error.resolved',
} as const;
```

---

### Step 5: Create RabbitMQ Service

**File:** `src/rabbitmq/rabbitmq.service.ts`

```typescript
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';
import { QUEUE_NAMES, EXCHANGE_NAMES } from './rabbitmq.config';

@Injectable()
export class RabbitMQService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitMQService.name);
  private connection: amqp.Connection | null = null;
  private channel: amqp.Channel | null = null;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    await this.connect();
    await this.setupQueuesAndExchanges();
    this.logger.log('✅ RabbitMQ connected and configured');
  }

  async onModuleDestroy() {
    await this.disconnect();
  }

  /**
   * Establish connection to RabbitMQ
   */
  private async connect(): Promise<void> {
    try {
      const url = this.configService.get<string>('rabbitmq.url');
      if (!url) {
        throw new Error('RABBITMQ_URL not configured');
      }

      this.connection = await amqp.connect(url);
      this.channel = await this.connection.createChannel();

      // Handle connection errors
      this.connection.on('error', (err) => {
        this.logger.error('RabbitMQ connection error:', err);
      });

      this.connection.on('close', () => {
        this.logger.warn('RabbitMQ connection closed, attempting reconnect...');
        setTimeout(() => this.connect(), 5000); // Reconnect after 5 seconds
      });

      this.logger.log('RabbitMQ connection established');
    } catch (error) {
      this.logger.error('Failed to connect to RabbitMQ:', error);
      throw error;
    }
  }

  /**
   * Setup queues, exchanges, and bindings
   */
  private async setupQueuesAndExchanges(): Promise<void> {
    if (!this.channel) {
      throw new Error('Channel not initialized');
    }

    // Create dead letter exchange
    await this.channel.assertExchange(EXCHANGE_NAMES.DEAD_LETTER_EXCHANGE, 'direct', {
      durable: true,
    });

    // Create dead letter queue
    await this.channel.assertQueue(QUEUE_NAMES.DEAD_LETTER, {
      durable: true,
    });

    // Bind dead letter queue to exchange
    await this.channel.bindQueue(
      QUEUE_NAMES.DEAD_LETTER,
      EXCHANGE_NAMES.DEAD_LETTER_EXCHANGE,
      '#', // Catch all routing keys
    );

    // Create main queues with dead letter configuration
    const queues = [
      QUEUE_NAMES.AI_EXECUTION,
      QUEUE_NAMES.QA_CHECK,
      QUEUE_NAMES.DEPLOYMENT,
      QUEUE_NAMES.MONITORING,
    ];

    for (const queueName of queues) {
      await this.channel.assertQueue(queueName, {
        durable: true, // Persist across restarts
        deadLetterExchange: EXCHANGE_NAMES.DEAD_LETTER_EXCHANGE,
        deadLetterRoutingKey: `dlx-${queueName}`,
        messageTtl: 3600000, // 1 hour
      });

      this.logger.log(`Queue created: ${queueName}`);
    }

    // Create main orchestrator events exchange
    await this.channel.assertExchange(EXCHANGE_NAMES.ORCHESTRATOR_EVENTS, 'topic', {
      durable: true,
    });

    this.logger.log('All queues and exchanges configured');
  }

  /**
   * Disconnect from RabbitMQ
   */
  private async disconnect(): Promise<void> {
    try {
      if (this.channel) {
        await this.channel.close();
        this.channel = null;
      }

      if (this.connection) {
        await this.connection.close();
        this.connection = null;
      }

      this.logger.log('🔌 RabbitMQ disconnected');
    } catch (error) {
      this.logger.error('Error disconnecting from RabbitMQ:', error);
    }
  }

  /**
   * Get channel for publishing/consuming
   */
  getChannel(): amqp.Channel {
    if (!this.channel) {
      throw new Error('RabbitMQ channel not available');
    }
    return this.channel;
  }

  /**
   * Health check for RabbitMQ connection
   */
  async isHealthy(): Promise<boolean> {
    return this.connection !== null && this.channel !== null;
  }

  /**
   * Get queue statistics (for monitoring)
   */
  async getQueueStats(queueName: string): Promise<{
    messageCount: number;
    consumerCount: number;
  }> {
    if (!this.channel) {
      throw new Error('Channel not available');
    }

    const queue = await this.channel.checkQueue(queueName);
    return {
      messageCount: queue.messageCount,
      consumerCount: queue.consumerCount,
    };
  }
}
```

---

### Step 6: Create Message Publisher Service

**File:** `src/rabbitmq/rabbitmq-publisher.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { RabbitMQService } from './rabbitmq.service';
import { v4 as uuidv4 } from 'uuid';

export interface MessagePayload {
  messageId?: string;
  timestamp?: string;
  correlationId?: string;
  payload: any;
}

@Injectable()
export class RabbitMQPublisherService {
  private readonly logger = new Logger(RabbitMQPublisherService.name);

  constructor(private rabbitMQService: RabbitMQService) {}

  /**
   * Publish message to a queue
   */
  async publishToQueue(queueName: string, payload: any, correlationId?: string): Promise<boolean> {
    try {
      const channel = this.rabbitMQService.getChannel();

      const message: MessagePayload = {
        messageId: uuidv4(),
        timestamp: new Date().toISOString(),
        correlationId: correlationId || uuidv4(),
        payload,
      };

      const sent = channel.sendToQueue(
        queueName,
        Buffer.from(JSON.stringify(message)),
        {
          persistent: true, // Survive broker restarts
          contentType: 'application/json',
          correlationId: message.correlationId,
          messageId: message.messageId,
          timestamp: Date.now(),
        },
      );

      if (sent) {
        this.logger.debug(`Message published to ${queueName}: ${message.messageId}`);
      } else {
        this.logger.warn(`Failed to publish to ${queueName} (queue full?)`);
      }

      return sent;
    } catch (error) {
      this.logger.error(`Error publishing to ${queueName}:`, error);
      throw error;
    }
  }

  /**
   * Publish message to exchange with routing key
   */
  async publishToExchange(
    exchangeName: string,
    routingKey: string,
    payload: any,
    correlationId?: string,
  ): Promise<boolean> {
    try {
      const channel = this.rabbitMQService.getChannel();

      const message: MessagePayload = {
        messageId: uuidv4(),
        timestamp: new Date().toISOString(),
        correlationId: correlationId || uuidv4(),
        payload,
      };

      const sent = channel.publish(
        exchangeName,
        routingKey,
        Buffer.from(JSON.stringify(message)),
        {
          persistent: true,
          contentType: 'application/json',
          correlationId: message.correlationId,
          messageId: message.messageId,
          timestamp: Date.now(),
        },
      );

      if (sent) {
        this.logger.debug(
          `Message published to exchange ${exchangeName} (${routingKey}): ${message.messageId}`,
        );
      }

      return sent;
    } catch (error) {
      this.logger.error(`Error publishing to exchange ${exchangeName}:`, error);
      throw error;
    }
  }

  /**
   * Publish with retry logic (3 attempts with exponential backoff)
   */
  async publishWithRetry(
    queueName: string,
    payload: any,
    maxRetries: number = 3,
    correlationId?: string,
  ): Promise<boolean> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.publishToQueue(queueName, payload, correlationId);
        if (result) {
          return true;
        }
      } catch (error) {
        lastError = error as Error;
        this.logger.warn(`Publish attempt ${attempt}/${maxRetries} failed:`, error);

        if (attempt < maxRetries) {
          // Exponential backoff: 1s, 2s, 4s
          const delay = Math.pow(2, attempt - 1) * 1000;
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw new Error(
      `Failed to publish after ${maxRetries} attempts: ${lastError?.message}`,
    );
  }
}
```

---

### Step 7: Create Message Consumer Base Class

**File:** `src/rabbitmq/rabbitmq-consumer.base.ts`

```typescript
import { Logger } from '@nestjs/common';
import * as amqp from 'amqplib';

export abstract class RabbitMQConsumerBase {
  protected abstract readonly logger: Logger;

  /**
   * Abstract method to process message
   * Subclasses must implement this
   */
  protected abstract processMessage(payload: any, correlationId: string): Promise<void>;

  /**
   * Handle incoming message with error handling
   */
  async handleMessage(message: amqp.ConsumeMessage, channel: amqp.Channel): Promise<void> {
    const content = message.content.toString();
    let messageId: string | undefined;
    let correlationId: string | undefined;

    try {
      const parsed = JSON.parse(content);
      messageId = parsed.messageId;
      correlationId = parsed.correlationId || messageId;

      this.logger.log(`Processing message ${messageId}`);

      // Process the message
      await this.processMessage(parsed.payload, correlationId);

      // Acknowledge message (manual ack)
      channel.ack(message);
      this.logger.log(`Message ${messageId} processed successfully`);
    } catch (error) {
      this.logger.error(`Error processing message ${messageId}:`, error);

      // Check retry count (stored in message headers)
      const retryCount = (message.properties.headers?.['x-retry-count'] as number) || 0;
      const maxRetries = 3;

      if (retryCount < maxRetries) {
        // Requeue with incremented retry count
        this.logger.warn(`Retrying message ${messageId} (attempt ${retryCount + 1}/${maxRetries})`);

        channel.nack(message, false, false); // Send to dead letter exchange
        // Dead letter exchange will route to retry queue with delay
      } else {
        // Max retries exceeded, send to dead letter queue
        this.logger.error(
          `Message ${messageId} failed after ${maxRetries} attempts, moving to DLQ`,
        );
        channel.nack(message, false, false);
      }
    }
  }
}
```

---

### Step 8: Create RabbitMQ Module

**File:** `src/rabbitmq/rabbitmq.module.ts`

```typescript
import { Global, Module } from '@nestjs/common';
import { RabbitMQService } from './rabbitmq.service';
import { RabbitMQPublisherService } from './rabbitmq-publisher.service';

@Global() // Makes RabbitMQ services available everywhere
@Module({
  providers: [RabbitMQService, RabbitMQPublisherService],
  exports: [RabbitMQService, RabbitMQPublisherService],
})
export class RabbitMQModule {}
```

---

### Step 9: Register RabbitMQModule in AppModule

**File:** `src/app.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';

// Configuration (must be first)
import { ConfigModule } from './config/config.module';

// Infrastructure
import { DatabaseModule } from './database/database.module';
import { RabbitMQModule } from './rabbitmq/rabbitmq.module'; // NEW

// ... other imports from Story 1.2 ...

@Module({
  imports: [
    // Configuration FIRST
    ConfigModule,

    // Infrastructure
    DatabaseModule,
    RabbitMQModule, // NEW: Add RabbitMQ module

    // ... rest of modules from Story 1.2 ...
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

---

### Step 10: Create Health Check Endpoint

**File:** `src/app.controller.ts` (update existing)

```typescript
import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { PrismaService } from './database/prisma.service';
import { RabbitMQService } from './rabbitmq/rabbitmq.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly prismaService: PrismaService,
    private readonly rabbitMQService: RabbitMQService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  async getHealth() {
    const dbHealthy = await this.checkDatabaseHealth();
    const rabbitMQHealthy = await this.rabbitMQService.isHealthy();

    const isHealthy = dbHealthy && rabbitMQHealthy;

    return {
      status: isHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      services: {
        database: dbHealthy ? 'up' : 'down',
        rabbitmq: rabbitMQHealthy ? 'up' : 'down',
      },
    };
  }

  private async checkDatabaseHealth(): Promise<boolean> {
    try {
      await this.prismaService.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
```

---

## Usage Examples

### Example 1: Publishing a Message to Queue

```typescript
import { Injectable } from '@nestjs/common';
import { RabbitMQPublisherService } from './rabbitmq/rabbitmq-publisher.service';
import { QUEUE_NAMES } from './rabbitmq/rabbitmq.config';

@Injectable()
export class TicketService {
  constructor(private rabbitMQPublisher: RabbitMQPublisherService) {}

  async processTicket(ticketId: string, executionId: string) {
    const payload = {
      ticketId,
      executionId,
      aiProvider: 'CURSOR',
      priority: 'high',
    };

    // Publish to AI execution queue
    await this.rabbitMQPublisher.publishToQueue(
      QUEUE_NAMES.AI_EXECUTION,
      payload,
      executionId, // Use executionId as correlationId for tracing
    );
  }
}
```

### Example 2: Publishing to Exchange with Routing Key

```typescript
import { Injectable } from '@nestjs/common';
import { RabbitMQPublisherService } from './rabbitmq/rabbitmq-publisher.service';
import { EXCHANGE_NAMES, ROUTING_KEYS } from './rabbitmq/rabbitmq.config';

@Injectable()
export class ExecutionService {
  constructor(private rabbitMQPublisher: RabbitMQPublisherService) {}

  async notifyExecutionStarted(executionId: string) {
    await this.rabbitMQPublisher.publishToExchange(
      EXCHANGE_NAMES.ORCHESTRATOR_EVENTS,
      ROUTING_KEYS.AI_EXECUTION_STARTED,
      {
        executionId,
        startedAt: new Date().toISOString(),
      },
      executionId,
    );
  }
}
```

### Example 3: Creating a Consumer (Preview for Story 2.10)

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { RabbitMQConsumerBase } from './rabbitmq/rabbitmq-consumer.base';

@Injectable()
export class AIExecutionConsumer extends RabbitMQConsumerBase {
  protected readonly logger = new Logger(AIExecutionConsumer.name);

  protected async processMessage(payload: any, correlationId: string): Promise<void> {
    const { ticketId, executionId, aiProvider } = payload;

    this.logger.log(`Processing AI execution ${executionId} for ticket ${ticketId}`);

    // TODO: Implement actual AI execution logic in Story 2.6-2.8
    // For now, just log the message

    this.logger.log(`AI execution ${executionId} would be processed here`);
  }
}
```

---

## Testing RabbitMQ Integration

### Unit Test Example

**File:** `src/rabbitmq/rabbitmq-publisher.service.spec.ts`

```typescript
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
    (channel.sendToQueue as jest.Mock)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);

    const result = await service.publishWithRetry('test-queue', { data: 'test' }, 3);
    expect(result).toBe(true);
    expect(channel.sendToQueue).toHaveBeenCalledTimes(2);
  });
});
```

### E2E Test Example

**File:** `test/rabbitmq.e2e-spec.ts`

```typescript
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
    const result = await publisherService.publishToQueue(
      QUEUE_NAMES.AI_EXECUTION,
      payload,
    );

    expect(result).toBe(true);
  });

  it('should get queue statistics', async () => {
    const stats = await rabbitMQService.getQueueStats(QUEUE_NAMES.AI_EXECUTION);

    expect(stats).toBeDefined();
    expect(stats.messageCount).toBeGreaterThanOrEqual(0);
    expect(stats.consumerCount).toBeGreaterThanOrEqual(0);
  });
});
```

---

## Manual Testing via RabbitMQ Management UI

### Access Management UI

1. **Open browser:** http://localhost:15672
2. **Login:** Username `guest`, Password `guest`
3. **Navigate to "Queues"** tab

### Verify Queues Created

You should see these queues:
- ✅ `ai-execution-queue`
- ✅ `qa-check-queue`
- ✅ `deployment-queue`
- ✅ `monitoring-queue`
- ✅ `dead-letter-queue`

### Publish Test Message

1. Click on `ai-execution-queue`
2. Scroll to "Publish message" section
3. Set Payload:
```json
{
  "messageId": "test-123",
  "timestamp": "2025-11-27T12:00:00Z",
  "correlationId": "test-correlation",
  "payload": {
    "ticketId": "ticket-123",
    "executionId": "exec-456",
    "aiProvider": "CURSOR"
  }
}
```
4. Click "Publish message"
5. Verify message count increases

### Monitor Message Flow

- **Queues tab:** View message counts, delivery rates
- **Exchanges tab:** View `orchestrator-events` and `dlx-exchange`
- **Connections tab:** View active connections from your application
- **Channels tab:** View active channels and their state

---

## Validation Checklist

Before marking this story as complete, verify:

**Installation & Setup:**
- [ ] `@nestjs/microservices` installed as dependency
- [ ] `amqplib` installed as dependency
- [ ] `@types/amqplib` installed as devDependency
- [ ] RabbitMQ added to `docker-compose.yml`

**Docker & RabbitMQ:**
- [ ] `docker-compose up -d` starts RabbitMQ successfully
- [ ] `docker-compose ps` shows rabbitmq container healthy
- [ ] RabbitMQ Management UI accessible at http://localhost:15672
- [ ] Can login with guest/guest credentials

**Environment Configuration:**
- [ ] `RABBITMQ_URL` added to `.env` file
- [ ] `RABBITMQ_URL` added to `.env.example` with documentation
- [ ] Connection string format is correct (amqp://)

**Code Structure:**
- [ ] `src/rabbitmq/rabbitmq.config.ts` created with queue names and routing keys
- [ ] `src/rabbitmq/rabbitmq.service.ts` created with connection management
- [ ] `src/rabbitmq/rabbitmq-publisher.service.ts` created for publishing
- [ ] `src/rabbitmq/rabbitmq-consumer.base.ts` created for consumers
- [ ] `src/rabbitmq/rabbitmq.module.ts` created and marked `@Global()`

**Application Integration:**
- [ ] `RabbitMQModule` imported in `app.module.ts`
- [ ] `@Global()` decorator present on RabbitMQModule
- [ ] Application starts without RabbitMQ errors
- [ ] Console shows "✅ RabbitMQ connected and configured"

**Queues & Exchanges:**
- [ ] `ai-execution-queue` created in RabbitMQ
- [ ] `qa-check-queue` created in RabbitMQ
- [ ] `deployment-queue` created in RabbitMQ
- [ ] `monitoring-queue` created in RabbitMQ
- [ ] `dead-letter-queue` created in RabbitMQ
- [ ] `dlx-exchange` (dead letter exchange) created
- [ ] `orchestrator-events` exchange created
- [ ] All queues are durable (persist across restarts)

**Message Configuration:**
- [ ] Manual acknowledgment configured (noAck: false)
- [ ] Dead letter exchange configured for all queues
- [ ] Message TTL set to 1 hour (3600000ms)
- [ ] Prefetch count set to 1 (process one message at a time)
- [ ] Messages marked as persistent (survive broker restarts)

**Health Check:**
- [ ] `/health` endpoint includes RabbitMQ status
- [ ] Health check returns "up" when RabbitMQ is connected
- [ ] Health check returns "down" when RabbitMQ is disconnected

**Testing:**
- [ ] `src/rabbitmq/rabbitmq-publisher.service.spec.ts` unit tests pass
- [ ] `test/rabbitmq.e2e-spec.ts` E2E tests pass
- [ ] Can publish message via Management UI
- [ ] Can see messages in queue statistics
- [ ] `npm run test` passes with RabbitMQ tests

**Error Handling:**
- [ ] Retry logic implemented (3 attempts with exponential backoff: 1s, 2s, 4s)
- [ ] Failed messages route to dead letter queue after max retries
- [ ] Connection errors logged appropriately
- [ ] Automatic reconnection works (test by stopping/starting RabbitMQ)

**Code Quality:**
- [ ] `npm run lint` shows no linting errors
- [ ] Prettier formatting applied to all new files
- [ ] TypeScript compiles without errors
- [ ] No secrets hardcoded in code

**Documentation:**
- [ ] `.env.example` has RABBITMQ_URL with example
- [ ] Queue names documented in `rabbitmq.config.ts`
- [ ] Routing keys documented with dot notation
- [ ] README.md updated with RabbitMQ setup instructions (if exists)

**Version Control:**
- [ ] All new files staged and committed
- [ ] `docker-compose.yml` changes committed
- [ ] No sensitive data committed
- [ ] Commit message: `feat: add RabbitMQ message queue integration`

---

## Objective
Implement RabbitMQ integration to enable asynchronous communication between system components. This includes setting up the RabbitMQ service, creating a publisher/consumer abstraction, and configuring the necessary exchanges and queues for the AI Orchestrator.

> [!NOTE]
> **Completion Notes (2025-11-30)**
> - Implemented RabbitMQ integration with `RabbitMQService`, `RabbitMQPublisherService`, and `RabbitMQConsumerBase`.
> - Configured `RabbitMQModule` as a global module.
> - Added RabbitMQ health check to `AppController`.
> - Verified with Unit Tests and E2E Tests.
> - Verified RabbitMQ Management UI is accessible.
> - **Note**: `test/jest-setup.ts` was updated to use `guest:guest` credentials for local testing.

---

## Common Pitfalls to Avoid

**Connection & Configuration:**
- ❌ **Don't** forget to start RabbitMQ before starting application
- ❌ **Don't** use `localhost` in production - use proper hostname
- ❌ **Don't** skip health checks - know when RabbitMQ is down

**Queues & Messages:**
- ❌ **Don't** use auto-acknowledgment (noAck: true) - causes message loss
- ❌ **Don't** forget to make queues durable - messages lost on restart
- ❌ **Don't** skip dead letter queue - failed messages disappear
- ❌ **Don't** forget prefetchCount - may overwhelm consumers

**Error Handling:**
- ❌ **Don't** acknowledge messages before processing - causes message loss
- ❌ **Don't** skip retry logic - transient failures become permanent
- ❌ **Don't** retry forever - implement max retries
- ❌ **Don't** ignore connection errors - log and alert

**Testing:**
- ❌ **Don't** use production queues for tests - use test database
- ❌ **Don't** skip cleanup in tests - causes test pollution
- ❌ **Don't** forget to wait for RabbitMQ init in tests - causes flaky tests

**Performance:**
- ❌ **Don't** process multiple messages concurrently without limits - overwhelms system
- ❌ **Don't** create new connections per request - connection pooling is critical
- ❌ **Don't** set TTL too low - messages expire before processing

---

## Expected RabbitMQ Configuration After Completion

**Management UI Overview:**
```
✅ Queues (5 total)
   - ai-execution-queue (durable, dlx configured)
   - qa-check-queue (durable, dlx configured)
   - deployment-queue (durable, dlx configured)
   - monitoring-queue (durable, dlx configured)
   - dead-letter-queue (durable)

✅ Exchanges (2 total)
   - orchestrator-events (topic, durable)
   - dlx-exchange (direct, durable)

✅ Connections (1+ active)
   - From ai-orchestrator application

✅ Channels (1+ active)
   - Publishing and consuming channels
```

**Application Logs:**
```
✅ RabbitMQ connection established
✅ Queue created: ai-execution-queue
✅ Queue created: qa-check-queue
✅ Queue created: deployment-queue
✅ Queue created: monitoring-queue
✅ All queues and exchanges configured
✅ RabbitMQ connected and configured
```

---

## References

### Source Documents

1. **[Architecture - Message Queue]** (`docs/architecture.md` - Lines 449-461)
   - RabbitMQ configuration requirements
   - NestJS microservices integration

2. **[Architecture - RabbitMQ Naming Conventions]** (`docs/architecture.md` - Lines 1402-1405)
   - Queue naming: kebab-case
   - Routing keys: dot.notation
   - Exchange naming

3. **[Architecture - Communication Patterns]** (`docs/architecture.md` - Lines 1466-1476)
   - RabbitMQ message format
   - Message structure with correlation IDs

4. **[Architecture - Error Recovery]** (`docs/architecture.md` - Lines 1496-1499)
   - Retry logic: 3 attempts with exponential backoff (1s, 2s, 4s)
   - Dead letter queue for fallback

5. **[Epics - Story 1.5]** (`docs/epics.md` - Lines 382-418)
   - Acceptance criteria
   - Queue names and purposes
   - Technical notes

---

## Prerequisites

**Required:**
- ✅ Story 1.1 Complete - NestJS project initialized
- ✅ Story 1.4 Complete - Environment configuration (for RABBITMQ_URL)
- ✅ Docker installed and running

**Verify Docker:**
```bash
docker --version
# Should show 20.x or higher

docker-compose --version
# Should show 2.x or higher
```

**Story Dependencies:** Story 1.1 (NestJS Project Initialization), Story 1.4 (Environment Configuration)

---

## Implementation Notes

### Critical Success Factors

1. **Manual Acknowledgment is Critical:** Using noAck: false ensures messages aren't lost if processing fails. Always acknowledge AFTER successful processing.

2. **Dead Letter Queue is Essential:** Without DLQ, failed messages disappear. DLQ allows you to inspect and manually reprocess failed messages.

3. **Retry Logic Prevents Data Loss:** Transient failures (network issues, temporary service unavailability) should retry automatically. Use exponential backoff to avoid overwhelming the system.

4. **Durable Queues for Reliability:** Durable queues persist across RabbitMQ restarts. Without durability, all queued messages are lost on restart.

### Architecture Alignment

This story implements:
- **[Architecture Decision: RabbitMQ]** - Robust message broker for async processing
- **[NFR-R3]** - Failed AI executions must be recoverable (via retry + DLQ)
- **[Communication Pattern]** - Standard message format with correlation IDs
- **[Error Recovery]** - 3 retries with exponential backoff (1s, 2s, 4s)

### Preparation for Future Stories

This RabbitMQ foundation enables:
- **Story 2.10:** AI Execution Queue Processing - Consume AI tasks asynchronously
- **Story 3.7:** QA Queue Processing - Consume quality check tasks
- **Story 4.5:** Deployment Queue - Trigger CI/CD pipelines asynchronously
- **Story 9.1:** Monitoring Queue - Production error events
- **All Async Stories:** Reliable async processing with retry and error handling

---

## Dev Agent Record

### Context Reference

This story was prepared with complete context analysis from:
- Architecture document (RabbitMQ configuration, Lines 449-461)
- Architecture patterns (Message format, retry logic, Lines 1466-1499)
- Epic 1 goals (establish async messaging infrastructure)
- PRD reliability requirements (NFR-R3: recoverable executions)
- NestJS microservices best practices

### File List

**Modified Files:**
- `docker-compose.yml` - Added RabbitMQ service configuration
- `package.json` - Added RabbitMQ dependencies
- `pnpm-lock.yaml` - Updated dependency lock file
- `src/app.module.ts` - Registered RabbitMQModule
- `src/app.controller.ts` - Added RabbitMQ health check
- `src/config/configuration.ts` - Added RabbitMQ URL configuration
- `test/jest-setup.ts` - Added RabbitMQ test environment variables
- `.env` - Added RABBITMQ_URL (gitignored)
- `.env.example` - Added RABBITMQ_URL example

**New Files:**
- `src/rabbitmq/rabbitmq.config.ts` - Queue names, exchanges, routing keys
- `src/rabbitmq/rabbitmq.service.ts` - Connection and queue management
- `src/rabbitmq/rabbitmq-publisher.service.ts` - Message publishing with retry
- `src/rabbitmq/rabbitmq-consumer.base.ts` - Base consumer class with error handling
- `src/rabbitmq/rabbitmq.module.ts` - Global RabbitMQ module
- `src/rabbitmq/rabbitmq-publisher.service.spec.ts` - Unit tests for publisher
- `test/rabbitmq.e2e-spec.ts` - E2E tests for integration

### Completion Notes

**Story Status:** Ready for developer implementation  
**Context Completeness:** ✅ COMPREHENSIVE  
**Developer Readiness:** ✅ FLAWLESS IMPLEMENTATION GUIDE CREATED

**Workflow After Story Completion:**
1. **Before Starting:** Update `sprint-status.yaml` → `1-5-rabbitmq-message-queue-integration: in-progress`
2. **Implementation:** Follow Steps 1-10 to set up complete RabbitMQ infrastructure
3. **Validation:** Complete all items in Validation Checklist (40 items)
4. **Version Control:** Commit with message `feat: add RabbitMQ message queue integration`
5. **Status Update:** Update `sprint-status.yaml` → `1-5-rabbitmq-message-queue-integration: review`
6. **Code Review:** Request review from Scrum Master via code-review workflow

---

**Document prepared by:** Bob (Scrum Master)  
**Preparation date:** 2025-11-27  
**Analysis method:** Ultimate BMad Method Story Context Engine  
**Quality level:** Developer-ready with zero ambiguity

