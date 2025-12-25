import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AIDecisionLog, AuditLog, Execution, FileLock, FileLockQueue } from '../../prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { RabbitMQService } from '../../rabbitmq/rabbitmq.service';
import { MetricsService } from '../../common/metrics/metrics.service';
import {
  TimelineResponseDto,
  TimelineEventDto,
  QueueMetricsDto,
  SystemHealthDto,
  FileLockResponseDto,
  FileLockDto,
  ComponentHealthDto,
} from '../dto/observability-dashboard.dto';

@Injectable()
export class ObservabilityDashboardService {
  private readonly logger = new Logger(ObservabilityDashboardService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rabbitmqService: RabbitMQService,
    private readonly metricsService: MetricsService,
  ) {}

  /**
   * AC#1: Get chronological timeline of events for a ticket
   * Combines AIDecisionLog, AuditLog, and Execution status changes
   */
  async getTicketTimeline(ticketId: string): Promise<TimelineResponseDto> {
    try {
      // Verify ticket exists
      const ticket = await this.prisma.ticket.findUnique({
        where: { id: ticketId },
      });

      if (!ticket) {
        throw new NotFoundException(`Ticket ${ticketId} not found`);
      }

      // Query AI decision logs
      const aiDecisionLogs = await this.prisma.aIDecisionLog.findMany({
        where: { ticket_id: ticketId },
        include: { execution: true },
        orderBy: { timestamp: 'asc' },
      });

      // Query audit logs for ticket lifecycle events
      const auditLogs = await this.prisma.auditLog.findMany({
        where: {
          entity_type: 'ticket',
          entity_id: ticketId,
        },
        orderBy: { created_at: 'asc' },
      });

      // Query executions for status changes
      const executions = await this.prisma.execution.findMany({
        where: { ticket_id: ticketId },
        orderBy: { created_at: 'asc' },
      });

      // Convert to timeline events
      const events: TimelineEventDto[] = [];

      // Add AI decision events
      aiDecisionLogs.forEach((log: AIDecisionLog) => {
        events.push({
          timestamp: log.timestamp,
          event_type: `ai_${log.action}`,
          description: `${log.agent_name}: ${log.action}`,
          metadata: {
            agent_name: log.agent_name,
            action: log.action,
            confidence: log.confidence,
            reasoning: log.reasoning,
          },
        });
      });

      // Add audit log events
      auditLogs.forEach((log: AuditLog) => {
        events.push({
          timestamp: log.created_at,
          event_type: log.action,
          description: `${log.action} on ${log.entity_type} by ${log.actor_type}${log.actor_id ? ` (${log.actor_id})` : ''}`,
          metadata: {
            entity_type: log.entity_type,
            entity_id: log.entity_id,
            actor_type: log.actor_type,
            actor_id: log.actor_id,
            before_state: log.before_state as Record<string, unknown>,
            after_state: log.after_state as Record<string, unknown>,
          },
        });
      });

      // Add execution status events
      executions.forEach((exec: Execution) => {
        if (exec.started_at) {
          events.push({
            timestamp: exec.started_at,
            event_type: 'execution_started',
            description: `Execution started`,
            metadata: { execution_id: exec.id, status: 'IN_PROGRESS' },
          });
        }

        if (exec.completed_at) {
          events.push({
            timestamp: exec.completed_at,
            event_type: 'execution_completed',
            description: `Execution completed successfully`,
            metadata: { execution_id: exec.id, status: 'COMPLETED' },
          });
        }

        if (exec.failed_at) {
          events.push({
            timestamp: exec.failed_at,
            event_type: 'execution_failed',
            description: `Execution failed: ${exec.error_message}`,
            metadata: {
              execution_id: exec.id,
              status: 'FAILED',
              error: exec.error_message,
            },
          });
        }
      });

      // Sort all events chronologically
      events.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

      return { events };
    } catch (error) {
      this.logger.error(`Failed to get timeline for ticket ${ticketId}`, error);
      throw error;
    }
  }

  /**
   * AC#2: Get RabbitMQ queue metrics with processing rates
   */
  async getQueueMetrics(): Promise<QueueMetricsDto> {
    try {
      // Get RabbitMQ queue stats
      const rabbitMQMetrics = await this.rabbitmqService.getQueueMetrics();

      // Calculate processing rates from Execution table
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const [recentCompletions, dailyCompletions] = await Promise.all([
        this.prisma.execution.count({
          where: {
            completed_at: { gte: oneHourAgo },
            status: 'COMPLETED',
          },
        }),
        this.prisma.execution.count({
          where: {
            completed_at: { gte: twentyFourHoursAgo },
            status: 'COMPLETED',
          },
        }),
      ]);

      // Processing rate in messages/hour
      const processingRatePerHour = recentCompletions; // Already per hour
      const dailyRate = Math.floor(dailyCompletions / 24);

      // Merge RabbitMQ metrics with processing rates
      return {
        'ai-execution-queue': {
          ...rabbitMQMetrics['ai-execution-queue'],
          rate: processingRatePerHour,
        },
        'qa-check-queue': {
          ...rabbitMQMetrics['qa-check-queue'],
          rate: dailyRate,
        },
        'deployment-queue': {
          ...rabbitMQMetrics['deployment-queue'],
          rate: dailyRate,
        },
      };
    } catch (error) {
      this.logger.error('Failed to get queue metrics', error);
      throw error;
    }
  }

  /**
   * AC#3: Get system health status with component checks
   */
  async getSystemHealth(): Promise<SystemHealthDto> {
    try {
      // Parallel health checks
      const [dbHealth, rabbitmqHealth, prometheusHealth] = await Promise.all([
        this.checkDatabaseHealth(),
        this.checkRabbitMQHealth(),
        this.checkPrometheusHealth(),
      ]);

      // Aggregate overall status
      let overallStatus: 'up' | 'degraded' | 'down' = 'up';

      if (
        dbHealth.status === 'down' ||
        rabbitmqHealth.status === 'down' ||
        prometheusHealth.status === 'down'
      ) {
        overallStatus = 'down';
      } else if (
        dbHealth.status === 'degraded' ||
        rabbitmqHealth.status === 'degraded' ||
        prometheusHealth.status === 'degraded'
      ) {
        overallStatus = 'degraded';
      }

      // Calculate uptime using process.uptime() for actual system uptime
      const uptime = Math.floor(process.uptime());

      return {
        status: overallStatus,
        components: {
          database: dbHealth,
          rabbitmq: rabbitmqHealth,
          prometheus: prometheusHealth,
        },
        uptime_seconds: uptime,
      };
    } catch (error) {
      this.logger.error('Failed to get system health', error);
      throw error;
    }
  }

  /**
   * AC#4: Get active file locks with conflict detection
   */
  async getFileLocks(): Promise<FileLockResponseDto> {
    try {
      // Query active file locks
      const activeLocks = await this.prisma.fileLock.findMany({
        where: { status: 'LOCKED' },
        include: {
          execution: true,
        },
        orderBy: { locked_at: 'desc' },
      });

      // Query waiting lock requests
      const waitingLocks = await this.prisma.fileLockQueue.findMany({
        where: { status: 'WAITING' },
        include: {
          execution: true,
        },
        orderBy: { requested_at: 'asc' },
      });

      // Group by file_path to detect conflicts
      const locksByFile = new Map<string, FileLockDto>();

      activeLocks.forEach((lock: FileLock) => {
        if (!locksByFile.has(lock.file_path)) {
          locksByFile.set(lock.file_path, {
            file_path: lock.file_path,
            locked_by_ticket_id: lock.ticket_id,
            locked_at: lock.locked_at,
            waiting_count: 0,
            waiting_tickets: [],
          });
        }
      });

      // Add waiting tickets to conflict map
      waitingLocks.forEach((waiting: FileLockQueue) => {
        const fileLock = locksByFile.get(waiting.file_path);
        if (fileLock) {
          const waitTimeSeconds = Math.floor((Date.now() - waiting.requested_at.getTime()) / 1000);

          fileLock.waiting_count++;
          fileLock.waiting_tickets.push({
            ticket_id: waiting.ticket_id,
            requested_at: waiting.requested_at,
            wait_time_seconds: waitTimeSeconds,
          });
        }
      });

      // Convert map to array
      const locks = Array.from(locksByFile.values());

      return { locks };
    } catch (error) {
      this.logger.error('Failed to get file locks', error);
      throw error;
    }
  }

  // ===================================================================
  // Private Helper Methods
  // ===================================================================

  private async checkDatabaseHealth(): Promise<ComponentHealthDto> {
    const startTime = Date.now();
    try {
      // Simple query to check DB health
      await this.prisma.$queryRaw`SELECT 1`;
      const latency = Date.now() - startTime;

      return {
        status: this.getHealthStatus(latency),
        latency_ms: latency,
        details: {
          connection_pool_active: 5, // TODO: Get from Prisma metrics
        },
      };
    } catch (error) {
      this.logger.error('Database health check failed', error);
      return {
        status: 'down',
        latency_ms: Date.now() - startTime,
        details: { error: 'Database connection failed' },
      };
    }
  }

  private async checkRabbitMQHealth(): Promise<ComponentHealthDto> {
    const startTime = Date.now();
    try {
      // Check RabbitMQ connection
      await this.rabbitmqService.ping();
      const latency = Date.now() - startTime;

      return {
        status: this.getHealthStatus(latency),
        latency_ms: latency,
      };
    } catch (error) {
      this.logger.error('RabbitMQ health check failed', error);
      return {
        status: 'down',
        latency_ms: Date.now() - startTime,
        details: { error: 'RabbitMQ connection failed' },
      };
    }
  }

  private async checkPrometheusHealth(): Promise<ComponentHealthDto> {
    const startTime = Date.now();
    try {
      // Query Prometheus metrics
      await this.metricsService.getSystemHealth();
      const latency = Date.now() - startTime;

      return {
        status: this.getHealthStatus(latency),
        latency_ms: latency,
      };
    } catch (error) {
      this.logger.error('Prometheus health check failed', error);
      return {
        status: 'down',
        latency_ms: Date.now() - startTime,
        details: { error: 'Prometheus query failed' },
      };
    }
  }

  /**
   * Map latency to health status
   * <100ms = up, 100-500ms = degraded, >500ms = down
   */
  private getHealthStatus(latencyMs: number): 'up' | 'degraded' | 'down' {
    if (latencyMs < 100) return 'up';
    if (latencyMs < 500) return 'degraded';
    return 'down';
  }
}
