import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as sgMail from '@sendgrid/mail';
import * as Handlebars from 'handlebars';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Interface definition for SendGrid's setApiKey method
 * to workaround potential type definition issues
 */
interface SendGridMailService {
  setApiKey(apiKey: string): void;
  send(data: sgMail.MailDataRequired): Promise<[sgMail.ClientResponse, unknown]>;
}

@Injectable()
export class EmailNotificationService {
  private readonly logger = new Logger(EmailNotificationService.name);
  private enabled: boolean = false;
  private fromAddress: string;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('SENDGRID_API_KEY');
    this.fromAddress =
      this.configService.get<string>('EMAIL_FROM_ADDRESS') || 'noreply@darksoftwarefactory.com';

    if (apiKey) {
      // Use type assertion to avoid potential type mismatch with @sendgrid/mail definition
      (sgMail as unknown as SendGridMailService).setApiKey(apiKey);
      this.enabled = true;
    } else {
      this.logger.warn('SENDGRID_API_KEY not configured. Email notifications disabled.');
    }
  }

  async sendEmail(
    userId: string,
    email: string,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (!this.enabled) {
      this.logger.debug('Email notifications disabled');
      return;
    }

    if (!email) {
      this.logger.warn(
        `No email address provided for user ${userId}. Cannot send email notification.`,
      );
      return;
    }

    try {
      const html = await this.renderTemplate(eventType, payload);
      const subject = this.formatEmailSubject(eventType, payload);

      await sgMail.send({
        to: email,
        from: this.fromAddress,
        subject,
        html,
      });

      this.logger.debug(
        `Email notification sent to user ${userId} (${email}) for event ${eventType}`,
      );
    } catch (error) {
      this.logger.error(`Failed to send email notification to user ${userId}:`, error);
      throw error;
    }
  }

  private async renderTemplate(
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<string> {
    try {
      const templateName = this.getTemplateName(eventType);
      const templatePath = path.join(
        process.cwd(),
        'src/notifications/templates',
        `${templateName}.hbs`,
      );

      // Check if template exists, fallback to default if not
      try {
        await fs.access(templatePath);
      } catch {
        this.logger.warn(`Template ${templateName}.hbs not found, using default template`);
        return `
          <h1>Notification: ${eventType}</h1>
          <p>You received a new notification from Dark Software Factory.</p>
          <pre>${JSON.stringify(payload, null, 2)}</pre>
        `;
      }

      // Validate template path to prevent directory traversal
      const normalizedPath = path.normalize(templatePath);
      const baseDir = path.join(process.cwd(), 'src/notifications/templates');
      if (!normalizedPath.startsWith(baseDir)) {
        throw new Error('Invalid template path');
      }
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- Path is validated above to prevent directory traversal
      const templateSource = await fs.readFile(normalizedPath, 'utf-8');
      const template = Handlebars.compile(templateSource);
      return template({
        eventType,
        timestamp: new Date().toLocaleString(),
        ...payload,
      });
    } catch (error) {
      this.logger.error(`Error rendering email template for ${eventType}:`, error);
      // Fallback to simple HTML
      return `
        <h1>Notification: ${eventType}</h1>
        <p>You received a new notification from Dark Software Factory.</p>
        <pre>${JSON.stringify(payload, null, 2)}</pre>
      `;
    }
  }

  private getTemplateName(eventType: string): string {
    const mapping: Record<string, string> = {
      'execution.completed': 'execution-completed',
      'execution.failed': 'execution-failed',
      'quality.failure': 'quality-failure',
      'cost.threshold_exceeded': 'cost-alert',
    };
    // eslint-disable-next-line security/detect-object-injection -- Safe: Using Object.hasOwn() to check property existence
    return Object.hasOwn(mapping, eventType) ? mapping[eventType] : 'default';
  }

  private formatEmailSubject(eventType: string, payload: Record<string, unknown>): string {
    return `[DSF] ${this.formatEventTitle(eventType)} - ${payload.projectName || 'Notification'}`;
  }

  private formatEventTitle(eventType: string): string {
    const titles: Record<string, string> = {
      'execution.completed': 'Execution Completed',
      'execution.failed': 'Execution Failed',
      'execution.started': 'Execution Started',
      'quality.failure': 'Quality Gate Failed',
      'cost.threshold_exceeded': 'Cost Alert',
      'deployment.success': 'Deployment Success',
      'deployment.failure': 'Deployment Failure',
    };
    // eslint-disable-next-line security/detect-object-injection -- Safe: Using Object.hasOwn() to check property existence
    return Object.hasOwn(titles, eventType) ? titles[eventType] : eventType;
  }
}
