// ============================================
// CRITICAL: Initialize Sentry FIRST
// Must run before NestJS bootstrap to capture
// all errors including startup failures
// ============================================
import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

// Initialize Sentry before any other imports if DSN is configured
if (process.env.SENTRY_DSN) {
  const isProduction = process.env.NODE_ENV === 'production';

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    release: process.env.SENTRY_RELEASE,
    sampleRate: isProduction ? 0.1 : 1.0, // 10% in prod, 100% in dev
    tracesSampleRate: 0.1,
    profilesSampleRate: 0.1,
    integrations: [nodeProfilingIntegration()],
    debug: process.env.SENTRY_DEBUG === 'true',
  });

  console.log(
    `[Sentry] Initialized for ${process.env.NODE_ENV} (sample rate: ${isProduction ? '10%' : '100%'})`,
  );
}

// Now import NestJS and app modules
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { LoggerService } from './common/logger';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false }), // Disable Fastify's default logger
  );

  const logger = app.get(LoggerService);
  app.useLogger(logger);

  await app.listen(3000, '0.0.0.0');
  logger.log(`Application is running on: ${await app.getUrl()}`);
}

// Wrap bootstrap in try-catch and capture errors to Sentry
bootstrap().catch((error) => {
  // Capture bootstrap errors to Sentry
  if (process.env.SENTRY_DSN) {
    Sentry.captureException(error);
    // Flush events before exiting
    Sentry.close(2000).then(() => {
      console.error('[Bootstrap Error]:', error);
      process.exit(1);
    });
  } else {
    console.error('[Bootstrap Error]:', error);
    process.exit(1);
  }
});
