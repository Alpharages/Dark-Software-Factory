import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppMetricsModule } from '@/common/metrics/metrics.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeService } from './realtime.service';
import { WsAuthGuard } from './guards/ws-auth.guard';

/**
 * Realtime Module - Socket.IO Real-Time Infrastructure
 * Story 10-U-1
 *
 * Provides:
 * - RealtimeGateway: WebSocket gateway with authentication
 * - RealtimeService: Event emission abstraction layer (exported for use by other modules)
 * - WsAuthGuard: WebSocket authentication guard
 */
@Module({
  imports: [
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: parseInt(configService.get<string>('JWT_EXPIRATION', '3600'), 10),
        },
      }),
      inject: [ConfigService],
    }),
    AppMetricsModule,
    forwardRef(() => NotificationsModule),
  ],
  providers: [RealtimeGateway, RealtimeService, WsAuthGuard],
  exports: [RealtimeService], // Export RealtimeService for use by other modules
})
export class RealtimeModule {}
