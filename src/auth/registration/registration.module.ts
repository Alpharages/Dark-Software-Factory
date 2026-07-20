import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DatabaseModule } from '../../database/database.module';
import { InvitationsModule } from '../invitations/invitations.module';
import { RegistrationService } from './registration.service';
import { RegistrationController } from './registration.controller';

@Module({
  imports: [
    DatabaseModule,
    // This MUST configure JwtModule itself. It previously imported the bare
    // `JwtModule` with the comment "Already configured in AuthModule" — but
    // Nest module config is not global: only modules importing AuthModule (which
    // re-exports its configured JwtModule) get the configured instance.
    // RegistrationModule imports neither, so it received a JwtService with no
    // secret and `sign()` threw `secretOrPrivateKey must have a value` — after
    // the user+invite transaction had already committed, permanently locking the
    // invitee out (REG-CRIT).
    //
    // Importing AuthModule here is not an option: AuthModule already imports
    // RegistrationModule, so that would be a cycle. Configuring locally matches
    // what realtime/dashboards/financial-metrics already do.
    // ponytail: 5th copy of this block — a shared JwtSigningModule is the
    // upgrade path if a 6th appears.
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('auth.jwtSecret'),
        // Same lifetime as AuthModule: this signs the post-registration
        // auto-login token, which is an ordinary session token.
        signOptions: { expiresIn: '24h', algorithm: 'HS256' as const },
        verifyOptions: { algorithms: ['HS256' as const] },
      }),
    }),
    InvitationsModule, // For InvitationsService
  ],
  providers: [RegistrationService],
  controllers: [RegistrationController],
  exports: [RegistrationService],
})
export class RegistrationModule {}
