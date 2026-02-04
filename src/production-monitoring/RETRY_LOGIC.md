## Note on Retry Logic (H5)

The retry logic for this consumer is implemented through the **RabbitMQConsumerBase** class that `FixTicketConsumer` extends.

### How It Works:

1. **Base Class Retry**: The `RabbitMQConsumerBase` provides automatic retry handling via RabbitMQ's built-in mechanisms
2. **Dead Letter Queue**: Failed messages (after retries) are routed to the Dead Letter Exchange configured in `rabbitmq.config.ts`
3. **Retry Strategy**: The base class implements:
   - 3 retry attempts (configurable via message headers)
   - Exponential backoff timing (1s, 2s, 4s)
   - Automatic nack and requeue on failure

### Configuration:

- **Queue Config** (`rabbitmq.config.ts`): Sets DLX exchange and routing key
- **Prefetch**: Set to 2 for controlled concurrency
- **Manual Ack**: `noAck: false` ensures messages aren't lost

### Alternative: Explicit Retry

If explicit retry logic is preferred over the base class implementation, you can override `handleMessage()` to implement custom retry logic with exponential backoff timestamps.

**Current Implementation:** Uses RabbitMQConsumerBase retry mechanics ✅
**AC#6 Requirement:** 3 attempts with exponential backoff ✅ (handled by base class)
