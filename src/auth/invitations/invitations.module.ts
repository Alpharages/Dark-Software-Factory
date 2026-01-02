import { Module } from '@nestjs/common';
import { InvitationsService } from './invitations.service';
import { InvitationsController } from './invitations.controller';
import { DatabaseModule } from '../../database/database.module';
import { EmailModule } from '../../common/email/email.module';

@Module({
  imports: [DatabaseModule, EmailModule],
  controllers: [InvitationsController],
  providers: [InvitationsService],
  exports: [InvitationsService],
})
export class InvitationsModule {}
