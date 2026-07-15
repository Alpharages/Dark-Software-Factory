import { TaskProviderType, TaskTriggerSource } from './dto';
import { TicketIntakeConsumer } from './ticket-intake.consumer';

describe('TicketIntakeConsumer', () => {
  const ticketIntakeService = {
    processTaskEvent: jest.fn(),
    resumeBlockedTicket: jest.fn(),
  };
  const consumer = new TicketIntakeConsumer({} as never, ticketIntakeService as never);
  const processMessage = (payload: unknown) =>
    (
      consumer as unknown as {
        processMessage(payload: unknown, correlationId: string): Promise<void>;
      }
    ).processMessage(payload, 'queue-correlation');

  beforeEach(() => {
    jest.clearAllMocks();
    ticketIntakeService.processTaskEvent.mockResolvedValue({
      success: true,
      status: 'QUEUED',
    });
  });

  it('processes normalized project-sync events using externalId', async () => {
    await processMessage({
      externalId: 'CU-123',
      providerType: TaskProviderType.CLICKUP,
      internalStatus: 'todo',
      title: 'Fix execution flow',
      description: 'Run the implementation workflow',
      triggerSource: TaskTriggerSource.SYNC,
      correlationId: 'publisher-correlation',
      projectIdentifier: 'project-1',
      taskUrl: 'https://app.clickup.com/t/CU-123',
    });

    expect(ticketIntakeService.processTaskEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        externalId: 'CU-123',
        correlationId: 'queue-correlation',
      }),
    );
  });

  it('keeps accepting legacy provider events using taskId', async () => {
    await processMessage({ taskId: 'CU-456', name: 'Legacy event' });

    expect(ticketIntakeService.processTaskEvent).toHaveBeenCalledWith({
      taskId: 'CU-456',
      name: 'Legacy event',
      correlationId: 'queue-correlation',
    });
  });

  it('rejects malformed task events before intake processing', async () => {
    await expect(processMessage({ name: 'Missing identifier' })).rejects.toThrow(
      'Ticket intake message is missing taskId/externalId',
    );
    expect(ticketIntakeService.processTaskEvent).not.toHaveBeenCalled();
  });

  it('routes dependency resolution signals to resume processing', async () => {
    await processMessage({ reason: 'dependencies_resolved', ticket_id: 'ticket-1' });

    expect(ticketIntakeService.resumeBlockedTicket).toHaveBeenCalledWith(
      'ticket-1',
      'queue-correlation',
    );
    expect(ticketIntakeService.processTaskEvent).not.toHaveBeenCalled();
  });
});
