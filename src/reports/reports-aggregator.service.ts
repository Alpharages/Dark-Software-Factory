import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class ReportsAggregatorService {
  private readonly logger = new Logger(ReportsAggregatorService.name);

  constructor(private readonly prisma: PrismaService) {}

  async aggregateData(projectId: string, dateStart: Date, dateEnd: Date) {
    this.logger.log(`Aggregating comprehensive data for project ${projectId}`);

    // 1. Fetch tickets UPDATED in date range (to catch status transitions)
    // Optimized: Only fetch what we need and use specific relation filtering if possible
    const ticketsInRange = await this.prisma.ticket.findMany({
      where: {
        project_id: projectId,
        updated_at: {
          gte: dateStart,
          lte: dateEnd,
        },
      },
      include: {
        executions: {
          orderBy: { created_at: 'desc' },
          take: 1, // Only need the latest for metrics
          include: {
            qa_result: true,
          },
        },
      },
    });

    // 2. Fetch upcoming tickets (READY-FOR-DEV)
    const upcomingTickets = await this.prisma.ticket.findMany({
      where: {
        project_id: projectId,
        status: 'VALIDATED', // Or whatever is next in queue
      },
      take: 10,
    });

    // 3. Process Metrics
    const status_breakdown: Record<string, number> = {};
    let completed_tickets = 0;
    let total_complexity = 0;
    let total_coverage = 0;
    let coverage_count = 0;
    let total_qa_pass_rate = 0;
    let qa_count = 0;

    ticketsInRange.forEach((ticket) => {
      status_breakdown[ticket.status] = (status_breakdown[ticket.status] || 0) + 1;

      if (ticket.status === 'COMPLETED') {
        completed_tickets++;
      }

      const latestExecution = ticket.executions[0]; // Already ordered by desc
      if (latestExecution) {
        if (ticket.status === 'COMPLETED') {
          total_complexity += latestExecution.complexity_score || 0;
        }

        if (latestExecution.qa_result) {
          qa_count++;
          if (latestExecution.qa_result.overall_passed) {
            total_qa_pass_rate += 100;
          }

          if (latestExecution.qa_result.test_coverage !== null) {
            total_coverage += latestExecution.qa_result.test_coverage;
            coverage_count++;
          }
        }
      }
    });

    // Calculate Velocity (Complexity per week)
    const daysInRange = Math.max(
      1,
      Math.ceil((dateEnd.getTime() - dateStart.getTime()) / (1000 * 60 * 60 * 24)),
    );
    const weeksInRange = daysInRange / 7;
    const velocity = weeksInRange > 0 ? total_complexity / weeksInRange : total_complexity;

    const average_qa_pass_rate = qa_count > 0 ? total_qa_pass_rate / qa_count : 0;
    const average_test_coverage = coverage_count > 0 ? total_coverage / coverage_count : 0;

    return {
      period: {
        start: dateStart.toISOString(),
        end: dateEnd.toISOString(),
        days: daysInRange,
      },
      summary: {
        completed_tickets,
        total_complexity,
        velocity: Math.round(velocity * 100) / 100,
      },
      ticket_breakdown: status_breakdown,
      quality_metrics: {
        average_qa_pass_rate: Math.round(average_qa_pass_rate * 10) / 10,
        average_test_coverage: Math.round(average_test_coverage * 10) / 10,
      },
      upcoming_sprint_plan: {
        ticket_count: upcomingTickets.length,
        top_priorities: upcomingTickets.map((t) => ({ id: t.id, title: t.title })),
      },
      timestamp: new Date().toISOString(),
    };
  }
}
