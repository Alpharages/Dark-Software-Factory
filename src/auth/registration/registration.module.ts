import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { DatabaseModule } from '../../database/database.module';
import { InvitationsModule } from '../invitations/invitations.module';
import { RegistrationService } from './registration.service';
import { RegistrationController } from './registration.controller';

@Module({
  imports: [
    DatabaseModule,
    JwtModule, // Already configured in AuthModule
    InvitationsModule, // For InvitationsService
  ],
  providers: [RegistrationService],
  controllers: [RegistrationController],
  exports: [RegistrationService],
})
export class RegistrationModule {}
