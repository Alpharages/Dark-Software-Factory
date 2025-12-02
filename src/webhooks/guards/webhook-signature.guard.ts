import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { FastifyRequest } from 'fastify';

/**
 * Guard to verify ClickUp webhook signatures
 *
 * Per architecture.md Security:
 * - Webhook signature verification using CLICKUP_WEBHOOK_SECRET
 * - Invalid signatures are rejected with 401 Unauthorized
 * - HMAC SHA-256 signature validation
 *
 * Per NFR-S11: GitHub/ClickUp integrations use fine-grained tokens with minimal permissions
 */
@Injectable()
export class WebhookSignatureGuard implements CanActivate {
  private readonly logger = new Logger(WebhookSignatureGuard.name);
  private readonly webhookSecret: string;

  constructor(private readonly configService: ConfigService) {
    this.webhookSecret = this.configService.get<string>('clickup.webhookSecret') || '';

    if (!this.webhookSecret) {
      this.logger.error('CLICKUP_WEBHOOK_SECRET is not configured!');
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();

    // Get the signature from headers
    // ClickUp sends signature in 'x-signature' header
    const signature = request.headers['x-signature'] as string;

    if (!signature) {
      this.logger.warn('Webhook request missing signature header');
      throw new UnauthorizedException('Missing webhook signature');
    }

    // Get the raw body for signature verification
    // Fastify stores raw body when configured with rawBody: true
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawBody = (request as any).rawBody as Buffer | undefined;

    if (!rawBody) {
      this.logger.error(
        'Raw body not available for signature verification. Ensure rawBody is enabled in Fastify adapter.',
      );
      throw new UnauthorizedException('Unable to verify signature');
    }

    // Verify the signature
    const isValid = this.verifySignature(rawBody, signature);

    if (!isValid) {
      this.logger.warn('Invalid webhook signature received');
      throw new UnauthorizedException('Invalid webhook signature');
    }

    this.logger.debug('Webhook signature verified successfully');
    return true;
  }

  /**
   * Verify HMAC SHA-256 signature
   *
   * ClickUp signs webhooks with HMAC-SHA256 using the webhook secret
   */
  private verifySignature(payload: Buffer | string, signature: string): boolean {
    try {
      const hmac = crypto.createHmac('sha256', this.webhookSecret);
      const digest = hmac.update(payload).digest('hex');

      // Use timing-safe comparison to prevent timing attacks
      const signatureBuffer = Buffer.from(signature);
      const digestBuffer = Buffer.from(digest);

      // Ensure buffers are same length for timing-safe comparison
      if (signatureBuffer.length !== digestBuffer.length) {
        return false;
      }

      return crypto.timingSafeEqual(signatureBuffer, digestBuffer);
    } catch (error) {
      this.logger.error(`Signature verification error: ${(error as Error).message}`);
      return false;
    }
  }
}
