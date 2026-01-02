import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtStrategy } from './strategies/jwt.strategy';
import { InvitationsModule } from './invitations/invitations.module';
import { RegistrationModule } from './registration/registration.module';
import { DatabaseModule } from '../database/database.module';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';

/**
 * Authentication Module
 *
 * Provides:
 * - JWT validation via Passport
 * - JwtStrategy for token extraction and validation
 * - User registration via invite tokens (Story 17-2)
 * - Login & session management (Story 17-3)
 *
 * Per architecture.md:
 * - Separate Auth Service issues JWTs (external)
 * - Orchestrator validates JWTs (this module)
 */
@Module({
  imports: [
    // Enable Passport with JWT as default strategy
    PassportModule.register({ defaultStrategy: 'jwt' }),

    // Configure JWT module (for token verification and signing)
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('auth.jwtSecret'),
        signOptions: {
          expiresIn: '24h', // Default expiration (auth service may override)
          algorithm: 'HS256',
        },
        verifyOptions: {
          algorithms: ['HS256'],
        },
      }),
    }),

    // Database access for user and token operations
    DatabaseModule,

    // Story 17-1: User Invitations
    InvitationsModule,

    // Story 17-2: User Registration
    RegistrationModule,
  ],
  providers: [JwtStrategy, AuthService],
  controllers: [AuthController],
  exports: [PassportModule, JwtModule, InvitationsModule, RegistrationModule, AuthService],
})
export class AuthModule {}
