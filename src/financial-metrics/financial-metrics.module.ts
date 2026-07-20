import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/database/database.module';
import { LoggerModule } from '@/common/logger/logger.module';
import { SentryModule } from '@/common/sentry/sentry.module';
import { AppMetricsModule } from '@/common/metrics/metrics.module';
import { FinancialMetricsService } from './financial-metrics.service';
import { FinancialMetricsController } from './financial-metrics.controller';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    DatabaseModule,
    LoggerModule,
    SentryModule,
    AppMetricsModule,
    // Same validated secret as AuthModule. The previous
    // `process.env.JWT_SECRET || 'fallback-secret'` would have accepted tokens
    // signed with a publicly-known secret if the env var were ever unset.
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('auth.jwtSecret'),
        signOptions: { expiresIn: '7d', algorithm: 'HS256' as const },
        verifyOptions: { algorithms: ['HS256' as const] },
      }),
    }),
  ],
  controllers: [FinancialMetricsController],
  providers: [FinancialMetricsService],
  exports: [FinancialMetricsService],
})
export class FinancialMetricsModule {}
