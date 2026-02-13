import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import * as fs from 'fs';
import * as path from 'path';
import * as handlebars from 'handlebars';
import { UserInvitation } from '@/prisma/client';

@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter;
  private invitationTemplate!: handlebars.TemplateDelegate;

  constructor(private configService: ConfigService) {
    this.transporter = nodemailer.createTransport({
      host: this.configService.get<string>('SMTP_HOST'),
      port: this.configService.get<number>('SMTP_PORT'),
      secure: this.configService.get<boolean>('SMTP_SECURE'),
      auth: {
        user: this.configService.get<string>('SMTP_USER'),
        pass: this.configService.get<string>('SMTP_PASS'),
      },
    });
  }

  onModuleInit() {
    this.loadTemplates();
  }

  private loadTemplates() {
    try {
      const templatePath = path.join(__dirname, '../../auth/templates/invitation-email.hbs');
      // Sync read is acceptable during startup/initialization
      const source = fs.readFileSync(templatePath, 'utf8');
      this.invitationTemplate = handlebars.compile(source);
      this.logger.log('Email templates loaded successfully');
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.stack : String(error);
      this.logger.error('Failed to load email templates', errorMessage);
      // We don't throw here to ensure the app creates the service,
      // but sending will fail if template is missing.
    }
  }

  async sendInvitationEmail(invitation: UserInvitation, inviterName: string) {
    try {
      if (!this.invitationTemplate) {
        // Try reloading if missing (e.g. if file was added after start)
        this.loadTemplates();
        if (!this.invitationTemplate) {
          throw new Error('Invitation email template is not loaded');
        }
      }

      const frontendUrl = this.configService.get<string>('FRONTEND_URL');
      const registrationLink = `${frontendUrl}/register?token=${invitation.invite_token}`;

      const html = this.invitationTemplate({
        role: invitation.role,
        inviterName,
        registrationLink,
        expiresAt: new Date(invitation.expires_at).toLocaleDateString(),
      });

      await this.transporter.sendMail({
        from: this.configService.get<string>('SMTP_FROM'),
        to: invitation.email,
        subject: 'You have been invited to DSF Dashboard',
        html,
      });

      this.logger.log(`Invitation email sent to ${invitation.email}`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.stack : String(error);
      this.logger.error(`Failed to send invitation email to ${invitation.email}`, errorMessage);
      // We don't throw to avoid blocking the main flow
    }
  }

  async sendEmail(options: { to: string; subject: string; body: string }) {
    try {
      await this.transporter.sendMail({
        from: this.configService.get<string>('SMTP_FROM'),
        to: options.to,
        subject: options.subject,
        html: options.body,
      });

      this.logger.log(`Email sent to ${options.to}`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.stack : String(error);
      this.logger.error(`Failed to send email to ${options.to}`, errorMessage);
      throw error; // Re-throw for callers to handle
    }
  }
}
