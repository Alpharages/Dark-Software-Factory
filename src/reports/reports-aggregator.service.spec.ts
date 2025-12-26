import { Test, TestingModule } from '@nestjs/testing';
import { ReportsAggregatorService } from './reports-aggregator.service';
import { PrismaService } from '../database/prisma.service';

describe('ReportsAggregatorService', () => {
  let service: ReportsAggregatorService;
  let prisma: PrismaService;

  const mockPrismaService = {
    ticket: {
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsAggregatorService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<ReportsAggregatorService>(ReportsAggregatorService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should aggregate ticket data correctly', async () => {
    const projectId = 'test-project';
    const start = new Date('2023-01-01');
    const end = new Date('2023-01-14');

    const mockTickets = [
      {
        id: '1',
        status: 'COMPLETED',
        executions: [
          {
            complexity_score: 5,
            qa_result: { overall_passed: true, test_coverage: 80 },
          },
        ],
      },
      {
        id: '2',
        status: 'COMPLETED',
        executions: [
          {
            complexity_score: 3,
            qa_result: { overall_passed: true, test_coverage: 90 },
          },
        ],
      },
      {
        id: '3',
        status: 'IN_PROGRESS',
        executions: [],
      },
    ];

    (mockPrismaService.ticket.findMany as jest.Mock)
      .mockResolvedValueOnce(mockTickets) // For ticketsInRange
      .mockResolvedValueOnce([]); // For upcomingTickets

    const result = await service.aggregateData(projectId, start, end);

    expect(result.summary.completed_tickets).toBe(2);
    expect(result.summary.total_complexity).toBe(8);
    expect(result.quality_metrics.average_qa_pass_rate).toBe(100);
    expect(result.quality_metrics.average_test_coverage).toBe(85);
    expect(result.ticket_breakdown['COMPLETED']).toBe(2);
    expect(result.ticket_breakdown['IN_PROGRESS']).toBe(1);
  });
});
