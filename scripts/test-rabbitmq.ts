
import * as amqp from 'amqplib';

async function testConnection() {
    const url = 'amqp://guest:guest@127.0.0.1:5672';
    console.log(`Connecting to ${url}...`);
    try {
        const conn = await amqp.connect(url);
        console.log('✅ Connection successful');
        const ch = await conn.createChannel();
        console.log('✅ Channel created');
        await ch.close();
        await conn.close();
        console.log('✅ Disconnected cleanly');
    } catch (error) {
        console.error('❌ Connection failed:', error);
        process.exit(1);
    }
}

testConnection();
