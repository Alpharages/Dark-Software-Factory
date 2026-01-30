
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { TicketIntakeService } from '../src/ticket-intake/ticket-intake.service';
import { PrismaService } from '../src/database/prisma.service';
import { RabbitMQPublisherService } from '../src/rabbitmq/rabbitmq-publisher.service';
import { ITaskEvent, TaskTriggerSource, TaskProviderType } from '../src/ticket-intake/dto';

async function bootstrap() {
    const logger = new Logger('TriggerE2E');

    // Mock RabbitMQ Publisher to avoid connection issues during validation test
    const mockRabbitMQPublisher = {
        publishToQueue: (queue: any, payload: any) => {
            logger.log(`[MOCK] Published to ${queue}: ${JSON.stringify(payload)}`);
            return Promise.resolve();
        }
    };

    const moduleRef = await Test.createTestingModule({
        imports: [AppModule],
    })
        .overrideProvider(RabbitMQPublisherService)
        .useValue(mockRabbitMQPublisher)
        .compile();

    const app = moduleRef.createNestApplication();
    await app.init();

    try {
        const intakeService = app.get(TicketIntakeService);
        const prismaService = app.get(PrismaService);

        const clickupTaskId = '86evv2pd9';
        const projectListId = '901813518753';

        logger.log(`Cleaning up existing ticket for task ${clickupTaskId}...`);
        // Clean up existing ticket to force reprocessing
        await prismaService.ticket.deleteMany({
            where: { clickup_task_id: clickupTaskId }
        });

        const event: ITaskEvent = {
            externalId: clickupTaskId,
            providerType: TaskProviderType.CLICKUP,
            internalStatus: 'QUEUED',
            title: '✨ Create Hello World API Endpoint',
            description: `## Description
Create a simple REST API endpoint that returns "Hello World"

## Requirements
- Create a new file \`src/hello/hello.controller.ts\`
- Implement a GET endpoint at \`/api/hello\`
- Return JSON: \`{ "message": "Hello World", "timestamp": "<current-time>" }\`
- Use NestJS decorators (@Controller, @Get)

## Acceptance Criteria
- [ ] File \`src/hello/hello.controller.ts\` is created
- [ ] Endpoint responds with correct JSON structure  
- [ ] Code follows NestJS best practices`,
            triggerSource: TaskTriggerSource.WEBHOOK,
            correlationId: 'test-e2e-' + Date.now(),
            projectIdentifier: projectListId,
            taskUrl: `https://app.clickup.com/t/${clickupTaskId}`,
            creatorEmail: 'tester@example.com',
            tags: [],
        };

        logger.log('Triggering intake process...');
        const result = await intakeService.processTaskEvent(event);

        logger.log('Intake Result: ' + JSON.stringify(result, null, 2));

        if (result.success) {
            logger.log('✅ Ticket successfully processed!');
            // Verify in DB
            const ticket = await prismaService.ticket.findUnique({
                where: { clickup_task_id: clickupTaskId },
                include: { executions: true }
            });
            logger.log('Ticket status in DB: ' + ticket?.status);
            if (ticket?.executions.length) {
                logger.log('Executions queued: ' + ticket.executions.length);
            } else {
                logger.log('No executions created yet (Routing via Queue mocked).');
            }
        } else {
            logger.error('❌ Ticket processing failed.');
        }

    } catch (error) {
        logger.error('Error during E2E test:', error);
    } finally {
        await app.close();
    }
}

bootstrap().catch(err => {
    console.error(err);
    process.exit(1);
});
