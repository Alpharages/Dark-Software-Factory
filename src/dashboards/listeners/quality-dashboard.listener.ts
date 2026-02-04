import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventBusService } from '@/common/event-bus.service';
import { QaResultCompletedEvent } from '@/qa-automation/events/qa-result-completed.event';
import { DashboardGateway } from '../gateways/dashboard.gateway';

@Injectable()
export class QualityDashboardListener implements OnModuleInit {
  private readonly logger = new Logger(QualityDashboardListener.name);

  constructor(
    private readonly eventBus: EventBusService,
    private readonly dashboardGateway: DashboardGateway,
  ) {}

  onModuleInit() {
    this.eventBus.on('qa.result.completed', (event: QaResultCompletedEvent) =>
      this.handleQaResultCompleted(event),
    );
  }

  handleQaResultCompleted(event: QaResultCompletedEvent) {
    this.logger.log(`Broadcasting quality update for execution ${event.executionId}`);

    // Broadcast generic update to project room
    this.dashboardGateway.broadcastQualityUpdate(event.projectId, {
      type: 'quality-update',
      timestamp: new Date(),
      executionId: event.executionId,
      ticketId: event.ticketId,
      overallPassed: event.overallPassed,
      metrics: event.metrics,
    });
  }
}
