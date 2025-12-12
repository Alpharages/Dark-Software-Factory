const amqp = require('amqplib');

const executionId = '5ccc99bb-2f5a-4104-9295-d5016992c6de';
const ticketId = 'c6ca86a0-c5ba-43c8-86ce-8aa0be6cbba1';

(async () => {
    const conn = await amqp.connect('amqp://localhost:5672');
    const ch = await conn.createChannel();

    const msg = {
        messageId: `qa-check-${Date.now()}`,
        correlationId: `qa-corr-${Date.now()}`,
        payload: {
            executionId: executionId,
            ticketId: ticketId,
            projectId: 'test-project',
            codeFiles: [
                {
                    path: 'src/test.ts',
                    content: '// Mock code output from AI execution\n// Successfully implemented the feature\nfunction testFeature() {\n  return "success";\n}',
                    language: 'typescript'
                },
                {
                    path: 'src/test.spec.ts',
                    content: 'import { testFeature } from "./test";\n\ndescribe("testFeature", () => {\n  it("should return success", () => {\n    expect(testFeature()).toBe("success");\n  });\n});',
                    language: 'typescript'
                }
            ],
            aiProvider: 'CURSOR_HEADLESS',
            timestamp: new Date().toISOString()
        }
    };

    await ch.assertQueue('qa-check-queue', { durable: true });
    ch.sendToQueue('qa-check-queue', Buffer.from(JSON.stringify(msg)), { persistent: true });
    console.log('✅ Published to qa-check-queue');
    console.log(`   Execution ID: ${executionId}`);
    console.log(`   Ticket ID: ${ticketId}`);

    setTimeout(() => { ch.close(); conn.close(); }, 500);
})();
