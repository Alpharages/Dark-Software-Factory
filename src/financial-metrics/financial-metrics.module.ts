import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/database/database.module';
import { LoggerModule } from '@/common/logger/logger.module';
import { SentryModule } from '@/common/sentry/sentry.module';
import { AppMetricsModule } from '@/common/metrics/metrics.module';
import { FinancialMetricsService } from './financial-metrics.service';
import { FinancialMetricsController } from './financial-metrics.controller';
import { JwtModule } from '@nestjs/jwt';

@Module({
    imports: [
        DatabaseModule,
        LoggerModule,
        SentryModule,
        AppMetricsModule,
        JwtModule.register({
            secret: process.env.JWT_SECRET || 'fallback-secret',
            signOptions: { expiresIn: '7d' },
        }),
    ],
    controllers: [FinancialMetricsController],
    providers: [FinancialMetricsService],
    exports: [FinancialMetricsService],
})
export class FinancialMetricsModule { }
