import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Inject } from '@nestjs/common';

@Injectable()
export class AuditLogService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  async log(params: {
    entityType: string;
    entityId: string;
    action: string;
    actorType: 'user' | 'system';
    actorId?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    beforeState?: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    afterState?: any;
  }): Promise<void> {
    const { entityType, entityId, action, actorType, actorId, beforeState, afterState } = params;

    try {
      await this.prisma.auditLog.create({
        data: {
          entity_type: entityType,
          entity_id: entityId,
          action,
          actor_type: actorType,
          actor_id: actorId,
          before_state: beforeState,
          after_state: afterState,
        },
      });

      this.logger.info(`Audit: ${action} on ${entityType} ${entityId}`, { ...params });
    } catch (error) {
      this.logger.error(`Failed to create audit log`, { error, params });
      // We don't throw here to avoid failing the main operation just because audit logging failed,
      // but in high security contexts we might want to throw.
    }
  }
}
