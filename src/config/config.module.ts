import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import configuration from './configuration';
import { envValidationSchema } from './env.validation';
import statusSkillMapConfig from './status-skill-map.config';

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true, // Makes ConfigService available everywhere
      load: [configuration, statusSkillMapConfig], // Load our typed configuration
      validationSchema: envValidationSchema, // Validate on startup
      validationOptions: {
        abortEarly: false, // Show all validation errors, not just first
        allowUnknown: true, // Allow extra env vars (for system vars)
      },
      cache: true, // Cache config values for performance
      expandVariables: true, // Support ${VAR} syntax in .env
    }),
  ],
})
export class ConfigModule {}
